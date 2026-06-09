import { apt, t } from "../../core/pub/js/qino.js";
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@18/+esm';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3/+esm';

class AiChat extends HTMLElement {
  static observedAttributes = ['bot'];

  #bot = 'cms-helper';
  #history = [];
  #context = {};
  #messages = null;
  #input = null;
  #button = null;

  /** Set additional context: chat.context = { page: { title, module, url }, extra: {} } */
  set context(value) { this.#context = value ?? {}; }

  async connectedCallback() {
    this.#bot = this.getAttribute('bot') ?? 'cms-helper';
    this.#context = {
      page: {
        title: document.title,
        url: location.href,
        id: globalThis.qino?.cms?.nodeId ?? null,
      },
    };
    this.innerHTML = `<style>
      ai-chat { display: flex; flex-direction: column; height: 100%; min-height: 200px; font-family: sans-serif; }
      ai-chat .msgs { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
      ai-chat .msg { padding: 6px 10px; border-radius: 6px; max-width: 80%; }
      ai-chat .msg.user { align-self: flex-end; background: var(--color); color: #fff; white-space: pre-wrap; }
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
    <div class="msgs"></div>
    <form>
      <input type="text" placeholder="${await t`Ask a question…`}" autocomplete="off">
      <button type="submit">${await t`Send`}</button>
    </form>`;

    this.#messages = this.querySelector('.msgs');
    this.#input = this.querySelector('input');
    this.#button = this.querySelector('button');
    this.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.#send();
    });
  }

  attributeChangedCallback(name, _, value) {
    if (name === 'bot') this.#bot = value;
  }

  async #send() {
    const text = this.#input.value.trim();
    if (!text) return;

    this.#input.value = '';
    this.#setLoading(true);
    this.#addMessage('user', text);
    this.#history.push({ role: 'user', content: text });

    const loading = this.#addMessage('assistant', '…');
    loading.classList.add('loading');

    try {
      const response = await apt.ai['chat-session'].post({ data: { bot: this.#bot, messages: this.#history, context: this.#context } });
      const content = typeof response === 'string' ? response : (response.response ?? response.error ?? 'Error');
      loading.innerHTML = DOMPurify.sanitize(marked.parse(content));
      loading.classList.remove('loading');

      if (response?.issue) {
        this.dispatchEvent(new CustomEvent('ai-issue', { bubbles: true, detail: response.issue }));
      }
      if ((response?.relevance ?? 1) >= 0.3) this.#history.push({ role: 'assistant', content });
    } catch (e) {
      loading.textContent = await t`Error: ${e.message}`;
      loading.classList.remove('loading');
      this.#history.pop();
    } finally {
      this.#setLoading(false);
    }
  }

  #addMessage(role, content) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = content;
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
