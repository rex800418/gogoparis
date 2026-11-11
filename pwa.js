(() => {
  "use strict";
  const status = document.querySelector("#pwa-status");
  const installButton = document.querySelector("#install-button");
  const updateButton = document.querySelector("#update-button");
  let installPrompt;
  let registration;
  let applyingUpdate = false;

  function setStatus(message) {
    status.textContent = message;
  }
  function installed() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone
    );
  }
  function updateNetworkStatus() {
    if (!navigator.onLine) {
      setStatus(
        "目前離線：可開啟已快取的頁面；送出與重新載入清單需要網路。未送出內容只留在目前頁面。",
      );
    } else if (registration?.waiting) {
      setStatus("有新版本可用。套用更新會重新載入，請先處理尚未送出的內容。");
    } else {
      setStatus(
        installed()
          ? "已以 App 模式開啟；報修送出與清單更新需要網路。"
          : "可加入主畫面使用；報修送出與清單更新需要網路。",
      );
    }
  }
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = installed();
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setStatus("請使用瀏覽器選單的安裝或加入主畫面功能。");
    }
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
    updateNetworkStatus();
  });
  updateButton.addEventListener("click", () => {
    if (!registration?.waiting) return;
    applyingUpdate = true;
    updateButton.disabled = true;
    registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  });
  updateNetworkStatus();
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    setStatus(
      "此瀏覽器或連線不支援離線快取；可繼續線上使用。安裝請使用 HTTPS 或 localhost。",
    );
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applyingUpdate) window.location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("./sw.js", {
        scope: "./",
        updateViaCache: "none",
      });
      const showUpdate = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller)
          return;
        updateButton.hidden = false;
        updateNetworkStatus();
      };
      showUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") showUpdate();
        });
      });
    } catch {
      setStatus(
        "離線快取未能啟用；目前仍可線上使用。請連線後重新開啟網頁再試。",
      );
    }
  });
})();
