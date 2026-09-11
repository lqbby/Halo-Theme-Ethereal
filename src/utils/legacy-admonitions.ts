// 旧版手写 Markdown 提示块兼容
export function initLegacyAdmonitions() {
  const blockquotes = document.querySelectorAll(
    ".custom-md blockquote:not(.admonition)",
  );

  blockquotes.forEach(function (blockquote) {
    const paragraphs = blockquote.querySelectorAll("p");

    if (paragraphs.length > 0) {
      const firstP = paragraphs[0] as HTMLElement;
      const firstText = firstP.textContent?.trim() || "";

      let type: string | null = null;
      let label: string | null = null;

      if (firstText.startsWith("[!NOTE]")) {
        type = "note";
        label = "NOTE";
      } else if (firstText.startsWith("[!TIP]")) {
        type = "tip";
        label = "TIP";
      } else if (firstText.startsWith("[!IMPORTANT]")) {
        type = "important";
        label = "IMPORTANT";
      } else if (firstText.startsWith("[!WARNING]")) {
        type = "warning";
        label = "WARNING";
      } else if (firstText.startsWith("[!CAUTION]")) {
        type = "caution";
        label = "CAUTION";
      }

      if (type) {
        blockquote.classList.add("admonition", `bdm-${type}`);

        const titleSpan = document.createElement("span");
        titleSpan.className = "bdm-title";
        titleSpan.textContent = label;

        const remainingContent = firstText.replace(`[!${label}]`, "").trim();
        if (remainingContent) {
          // 只剥离首段**第一个文本节点**里的 [!LABEL] 前缀，保留其余子节点：
          // 原 `firstP.textContent = remainingContent` 会把 <code>/<a>/<strong>
          // 等内联元素整体抹平成纯文本，导致代码样式/链接丢失。
          const firstNode = firstP.firstChild;
          if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
            firstNode.textContent = (firstNode.textContent || "")
              .replace(`[!${label}]`, "")
              .replace(/^\s+/, "");
          }
          blockquote.insertBefore(titleSpan, firstP);
        } else {
          firstP.replaceWith(titleSpan);
        }
      }
    }
  });
}
