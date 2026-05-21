export function getWidgetStyles(primaryColor: string): string {
  return `
    :host {
      all: initial;
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .docops-trigger {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${primaryColor};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
      transition: transform 0.2s, box-shadow 0.2s;
      z-index: 999999;
    }
    .docops-trigger:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 32px rgba(0,0,0,0.3);
    }
    .docops-trigger svg { width: 24px; height: 24px; fill: white; }

    .docops-panel {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 520px;
      border-radius: 16px;
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      box-shadow: 0 16px 64px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999998;
      animation: slideUp 0.3s ease;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .docops-header {
      padding: 16px 20px;
      background: linear-gradient(135deg, ${primaryColor}, ${primaryColor}dd);
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .docops-header h3 {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .docops-header button {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 18px;
      opacity: 0.8;
    }
    .docops-header button:hover { opacity: 1; }

    .docops-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .docops-messages::-webkit-scrollbar { width: 4px; }
    .docops-messages::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 2px; }

    .docops-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .docops-msg.user {
      align-self: flex-end;
      background: ${primaryColor};
      color: white;
      border-bottom-right-radius: 4px;
    }
    .docops-msg.assistant {
      align-self: flex-start;
      background: #252540;
      color: #e8e8f0;
      border-bottom-left-radius: 4px;
    }
    .docops-msg.typing {
      color: #8888a0;
      font-style: italic;
    }

    .docops-input-area {
      padding: 12px 16px;
      border-top: 1px solid #2a2a4a;
      display: flex;
      gap: 8px;
      background: #141428;
    }
    .docops-input-area input {
      flex: 1;
      height: 38px;
      padding: 0 12px;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      background: #1a1a2e;
      color: #e8e8f0;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .docops-input-area input:focus { border-color: ${primaryColor}; }
    .docops-input-area input::placeholder { color: #5a5a7a; }

    .docops-input-area button {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      background: ${primaryColor};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;
    }
    .docops-input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .docops-input-area button svg { width: 16px; height: 16px; fill: white; }

    .hidden { display: none !important; }

    .docops-citations {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #c4c5d5;
      font-size: 11px;
      color: #444653;
      line-height: 1.4;
    }
    .docops-warning {
      background: rgba(255, 219, 206, 0.4);
      border: 1px solid #ffdbce;
      color: #611e00;
      padding: 6px 10px;
      margin-top: 8px;
      border-radius: 6px;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .docops-warning::before {
      content: "⚠";
    }
  `
}
