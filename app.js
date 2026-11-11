(() => {
  "use strict";

  const form = document.querySelector("#repair-form");
  const fields = document.querySelector("#form-fields");
  const submitButton = document.querySelector("#submit-button");
  const refreshButton = document.querySelector("#refresh-button");
  const formMessage = document.querySelector("#form-message");
  const listMessage = document.querySelector("#list-message");
  const list = document.querySelector("#request-list");
  const filterButtons = document.querySelectorAll("[data-filter]");
  const filterMessage = document.querySelector("#filter-message");
  let loadedRequests = [];
  let activeFilter = "全部";
  let hasLoaded = false;
  const categories = ["設備", "網路", "環境", "其他"];
  const urgencies = ["低", "中", "高"];
  let client;
  let submitting = false;

  function showMessage(element, message, kind = "") {
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
  }

  function errorDetail(error) {
    return error?.message || "無法連線，請檢查網路後再試一次。";
  }

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function renderRequests(requests) {
    list.replaceChildren();
    for (const request of requests) {
      const card = textElement("li", "", "request-card");
      const top = textElement("div", "", "card-top");
      const urgency = textElement(
        "span",
        `緊急程度：${request.urgency}`,
        "badge",
      );
      urgency.dataset.urgency = request.urgency;
      const time = document.createElement("time");
      const date = new Date(request.created_at);
      if (!Number.isNaN(date.getTime())) {
        time.dateTime = date.toISOString();
        time.textContent = new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
        time.title = "台北時間";
      } else {
        time.textContent = "時間未提供";
      }
      top.append(
        textElement("span", request.category, "badge"),
        urgency,
        textElement("span", request.status || "待處理", "badge"),
        time,
      );
      card.append(
        top,
        textElement("h3", `${request.location} · ${request.reporter_name}`),
        textElement("p", request.description),
      );
      list.append(card);
    }
  }

  function renderFilteredRequests() {
    const visibleRequests =
      activeFilter === "全部"
        ? loadedRequests
        : loadedRequests.filter((request) => request.urgency === activeFilter);
    renderRequests(visibleRequests);
    showMessage(
      filterMessage,
      hasLoaded && activeFilter !== "全部"
        ? visibleRequests.length
          ? `目前顯示緊急程度「${activeFilter}」的 ${visibleRequests.length} 筆報修（限已載入的最近 20 筆）。`
          : `已載入的清單中沒有緊急程度「${activeFilter}」的報修。`
        : "",
    );
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      filterButtons.forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
      renderFilteredRequests();
    });
  });

  async function loadRequests() {
    refreshButton.disabled = true;
    list.setAttribute("aria-busy", "true");
    showMessage(listMessage, "正在載入報修紀錄…");
    try {
      const { data, error } = await client
        .from("repair_requests")
        .select(
          "id,reporter_name,location,category,description,urgency,status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      loadedRequests = data || [];
      hasLoaded = true;
      renderFilteredRequests();
      showMessage(
        listMessage,
        data?.length ? "" : "目前還沒有報修紀錄，填寫上方表單即可新增。",
      );
    } catch (error) {
      const retained = loadedRequests.length
        ? "（下方保留上次載入的紀錄）"
        : "";
      showMessage(
        listMessage,
        `清單載入失敗${retained}：${errorDetail(error)} 請按「重新整理」重試。`,
        "error",
      );
    } finally {
      refreshButton.disabled = false;
      list.setAttribute("aria-busy", "false");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client || submitting || !form.reportValidity()) return;
    const values = new FormData(form);
    const payload = {
      reporter_name: values.get("reporter_name").trim(),
      location: values.get("location").trim(),
      category: values.get("category"),
      description: values.get("description").trim(),
      urgency: values.get("urgency"),
    };
    if (
      !payload.reporter_name ||
      !payload.location ||
      !payload.description ||
      !categories.includes(payload.category) ||
      !urgencies.includes(payload.urgency)
    ) {
      showMessage(formMessage, "請填妥所有欄位，文字不能只有空白。", "error");
      return;
    }
    submitting = true;
    fields.disabled = true;
    submitButton.textContent = "送出中…";
    showMessage(formMessage, "正在送出報修，請稍候…");
    try {
      // 僅新增五個表單欄位；status、created_at 與 id 使用資料庫預設值。
      const { error } = await client.from("repair_requests").insert(payload);
      if (error) throw error;
      form.reset();
      showMessage(
        formMessage,
        "報修已成功送出！可在下方查看最新紀錄。",
        "success",
      );
      await loadRequests();
    } catch (error) {
      showMessage(
        formMessage,
        `送出未成功確認：${errorDetail(error)} 輸入內容已保留；若為連線中斷，請先重新整理清單確認是否已登記，再決定是否重送。`,
        "error",
      );
    } finally {
      submitting = false;
      fields.disabled = false;
      submitButton.textContent = "送出報修 →";
    }
  });

  try {
    const config = window.REPAIR_CONFIG;
    if (
      !window.supabase?.createClient ||
      !config?.supabaseUrl ||
      !config?.supabasePublishableKey
    ) {
      throw new Error("設定或連線元件未載入，請重新載入網頁。");
    }
    client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    refreshButton.addEventListener("click", loadRequests);
    loadRequests();
  } catch (error) {
    fields.disabled = true;
    refreshButton.disabled = true;
    list.setAttribute("aria-busy", "false");
    showMessage(formMessage, errorDetail(error), "error");
    showMessage(listMessage, "目前無法載入清單，請重新載入網頁。", "error");
  }
})();
