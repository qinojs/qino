import '@qino/pub/c1.js';
import "../../ai/pub/chat.js";

// Registers a toolbar entry on the shared editor — which inline.js also fetches alongside.
import("./rte.js");

// registers <ai-chat>

// The CMS panel lives in the shadow DOM of <qino-cms>; mount the chat there so it stays isolated from the page.
customElements.whenDefined("qino-cms").then(async () => {
  const { SelectorObserver } = await import("@qino/u2/js/SelectorObserver/SelectorObserver.js");
  const root = document.querySelector("qino-cms").shadowRoot;
  new SelectorObserver({ on: () => {
    if (root.querySelector(".cmsChatWrapper")) return;
    const wrap = c1.dom.el(`
      <div xonmousedown="event.stopPropagation();">
        <style>
          .cmsChatWrapper {
            position:fixed;
            bottom:2rem;
            left:5rem;
            right:5rem;
            max-width:50rem;
            margin:auto;
            z-index:9000;
            background:var(--color-bg);
            color:var(--color-text);
            box-shadow: var(--shadow);
            font-size:12px;
            display:flex;
            flex-direction:column;
            max-height:70vh;
          }
          .cmsChatWrapper ai-chat {
            height:100%;
            min-height:0;
          }
        </style>
        <div u2-movable class="cmsChatWrapper qgCMS">
          <div u2-movable-handler style="background:var(--cms-color); color:#fff; padding:.5rem; cursor:move">CMS Helper</div>
          <ai-chat bot=cms-helper></ai-chat>
        </div>
      </div>`);
    root.append(wrap);
  } }).observe("#panel", { root });
});
