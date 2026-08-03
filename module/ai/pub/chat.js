import { apt, t } from "../../core/pub/js/qino.js";
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@18/+esm';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3/+esm';

const apiBase = new URL("api/", location.origin + (globalThis.qino?.appUrl ?? "/"));

class AiChat extends HTMLElement {
  static observedAttributes = ['bot'];

  #bot = null;
  #context = {};
  #sessionId = null;
  #messages = null;
  #input = null;
  #button = null;
  #open = false;
  #historyLoad = null;

  // Collapse the history only when interaction moves outside the whole chat (composedPath crosses the shadow root).
  #outside = (e) => { if (!e.composedPath().includes(this)) this.#setOpen(false); };

  /** Set additional context: chat.context = { page: { title, module, url }, extra: {} } */
  set context(value) { this.#context = value ?? {}; }

  async connectedCallback() {
    this.#bot = this.getAttribute('bot');
    this.#context = {
      page: {
        title: document.title,
        url: location.href,
        id: globalThis.qino?.cms?.nodeId ?? null,
      },
    };
    this.innerHTML = `<style>
      ai-chat { display: flex; flex-direction: column; height: 100%; font-family: sans-serif; }
      ai-chat .msgs { flex: 1; overflow-y: auto; padding: 8px; display: none; flex-direction: column; gap: 6px; }
      ai-chat.has-messages.-open .msgs { display: flex; }
      ai-chat .msg { padding: 6px 10px; border-radius: 6px; max-width: 80%; }
      ai-chat .msg.user { align-self: flex-end; background: var(--color, #2563eb); color: #fff; white-space: pre-wrap; }
      ai-chat .msg.assistant { align-self: flex-start; background: #f0f0f0; }
      ai-chat .msg.assistant p { margin: 0 0 6px; }
      ai-chat .msg.assistant p:last-child { margin-bottom: 0; }
      ai-chat .msg.assistant ul, ai-chat .msg.assistant ol { margin: 0 0 6px; padding-left: 20px; }
      ai-chat .msg.assistant code { background: #ddd; border-radius: 3px; padding: 1px 4px; font-size: 0.9em; }
      ai-chat .msg.assistant pre { background: #ddd; border-radius: 4px; padding: 8px; overflow-x: auto; }
      ai-chat .msg.assistant pre code { background: none; padding: 0; }
      ai-chat .msg.loading { opacity: 0.5; }
      ai-chat form { display: flex; gap: 4px; padding: 8px; border-top: 1px solid #ddd; }
      ai-chat input { flex: 1; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
    </style>
    <div class=msgs></div>
    <form>
      <input type=text placeholder="${await t`Ask a question…`}" autocomplete=off>
      <button type=submit>${await t`Send`}</button>
    </form>`;

    this.#messages = this.querySelector('.msgs');
    this.#input = this.querySelector('input');
    this.#button = this.querySelector('button');
    this.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.#send();
    });
    this.addEventListener('focusin', () => this.#setOpen(true));
  }

  disconnectedCallback() { this.#setOpen(false); }

  attributeChangedCallback(name, _, value) {
    if (name === 'bot') this.#bot = value;
  }

  #setOpen(open) {
    if (open === this.#open) return;
    this.#open = open;
    this.classList.toggle('-open', open);
    const method = open ? 'addEventListener' : 'removeEventListener';
    document[method]('pointerdown', this.#outside, true);
    document[method]('focusin', this.#outside, true);
    if (open) this.#loadHistory();
  }

  get #storeKey() { return `ai-chat:${this.#bot}`; }

  // Resume the stored session lazily on first focus; a stale id (deleted/foreign) is discarded.
  #loadHistory() {
    return this.#historyLoad ??= (async () => {
      const id = Number(sessionStorage.getItem(this.#storeKey));
      if (!id) return;
      try {
        const { messages } = await apt.ai.sessions(id).get();
        this.#sessionId = id;
        for (const { role, content } of messages) {
          const el = this.#addMessage(role, content);
          if (role === 'assistant') el.innerHTML = DOMPurify.sanitize(marked.parse(content));
        }
      } catch {
        sessionStorage.removeItem(this.#storeKey);
      }
    })();
  }

  async #session() {
    if (this.#sessionId) return this.#sessionId;
    await this.#loadHistory(); // don't fork a resumable session
    if (this.#sessionId) return this.#sessionId;
    const { id } = await apt.ai.sessions.post({ bot: this.#bot, context: this.#context });
    sessionStorage.setItem(this.#storeKey, id);
    return (this.#sessionId = id);
  }

  async #send() {
    const text = this.#input.value.trim();
    if (!text) return;

    this.#input.value = '';
    this.#setLoading(true);
    this.#addMessage('user', text);

    const out = this.#addMessage('assistant', '…');
    out.classList.add('loading');
    let acc = '';

    try {
      const id = await this.#session();
      const res = await fetch(new URL(`ai/sessions/${id}/stream`, apiBase), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-CSRF-Token': globalThis.qino?.csrfToken },
        body: JSON.stringify({ content: text, context: this.#context }),
      });
      await readStream(res, (ev) => {
        if (ev.delta != null) {
          acc += ev.delta;
          out.classList.remove('loading');
          out.innerHTML = DOMPurify.sanitize(marked.parse(acc));
          out.scrollIntoView({ block: 'nearest' });
        } else if ('done' in ev) {
          finish(out, ev.done, acc);
        } else if (ev.error) {
          out.textContent = ev.error;
          out.classList.remove('loading');
        }
      });
    } catch (e) {
      out.textContent = await t`Error: ${e.message}`;
      out.classList.remove('loading');
    } finally {
      this.#setLoading(false);
    }
  }

  #addMessage(role, content) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = content;
    this.classList.add('has-messages'); // reveals the history (only while focused, see CSS)
    this.#messages.append(el);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return el;
  }

  #setLoading(on) {
    this.#button.disabled = on;
    this.#input.disabled = on;
    if (!on) this.#input.focus();
  }
}

customElements.define('ai-chat', AiChat);



function finish(out, done, acc) {
  out.classList.remove('loading');
  out.innerHTML = DOMPurify.sanitize(marked.parse(done || acc));
}

async function readStream(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      for (const line of event.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/);
        if (m) try { onEvent(JSON.parse(m[1])); } catch { /* keepalive */ }
      }
    }
  }
}
