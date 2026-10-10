// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 打字机效果
// 2.7：初始化骨架与 banner-drop 逐字重复，提取到 _banner-title-shared.ts 共享
import { initBannerSubtitle } from "./_banner-title-shared";
import { guardOnce } from "../../utils/once";

(function () {
  // P1（1.2.86）：requestIdleCallback 错峰工具（无 ric 时降级 setTimeout，timeout 兜底保证执行）
  function onIdle(cb) {
    if ("requestIdleCallback" in window)
      requestIdleCallback(cb, { timeout: 2000 });
    else setTimeout(cb, 1);
  }
  var TypewriterEffect = function (el, lines) {
    this.el = el;
    this.lines = lines;
    this.index = 0;
    this.charIdx = 0;
    this.deleting = false;
    this.timeoutId = null;
    this.typeSpeed = 80;
    this.deleteSpeed = 40;
    this.pauseAfterType = 2000;
    this.pauseAfterDelete = 500;

    var self = this;
    self.setText("");
    self.timeoutId = setTimeout(function () {
      self.type();
    }, 500);
  };

  TypewriterEffect.prototype.setText = function (text) {
    this.el.textContent = text || "\u00A0";
  };

  TypewriterEffect.prototype.type = function () {
    var self = this;
    var text = self.lines[self.index];
    if (!self.deleting) {
      self.charIdx++;
      self.setText(text.substring(0, self.charIdx));
      if (self.charIdx >= text.length) {
        if (self.lines.length > 1) {
          self.deleting = true;
          self.timeoutId = setTimeout(function () {
            self.type();
          }, self.pauseAfterType);
        }
        return;
      }
      self.timeoutId = setTimeout(function () {
        self.type();
      }, self.typeSpeed);
    } else {
      self.charIdx--;
      self.setText(text.substring(0, self.charIdx));
      if (self.charIdx <= 0) {
        self.deleting = false;
        self.index = (self.index + 1) % self.lines.length;
        self.timeoutId = setTimeout(function () {
          self.type();
        }, self.pauseAfterDelete);
        return;
      }
      self.timeoutId = setTimeout(function () {
        self.type();
      }, self.deleteSpeed);
    }
  };

  TypewriterEffect.prototype.destroy = function () {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  };

  // 光标闪烁（CSS 驱动，样式见 components.css 的 .banner-cursor-blink）：
  // 1.06s 周期、前 50% 亮后 50% 灭，与原 setInterval(530ms) 观感一致。
  // 摘/挂 class 即重启相位 —— 不再有定时器，换页重挂与后台恢复都只是「摘/挂类」，
  // 不存在「漏清 interval」导致的常驻定时器（原 __blinkInterval 三处读写）。
  var BLINK_CLASS = "banner-cursor-blink";

  function startCursorBlink(cursor) {
    cursor.classList.remove(BLINK_CLASS);
    cursor.style.opacity = ""; // 清掉旧实现可能留下的 inline 透明度，交给动画控制
    // 强制一次回流后重新挂类，让动画从 0% 起播（与全站「重新加类重播动画」同一手法）
    void cursor.offsetWidth;
    cursor.classList.add(BLINK_CLASS);
  }

  function stopCursorBlink(cursor) {
    cursor.classList.remove(BLINK_CLASS);
  }

  function initTypewriter() {
    // 骨架（取元素/隐藏判定/销毁旧实例/读文案）见 _banner-title-shared.ts；
    // 本脚本专属的清空文本与光标重挂通过回调插在销毁之后、读文案之前（顺序与原版一致）
    initBannerSubtitle(
      "__twInstance",
      function (el, lines) {
        return new TypewriterEffect(el, lines);
      },
      function (el) {
        el.textContent = "";
        var cursor = document.getElementById("banner-cursor");
        if (cursor) {
          // 重启相位（内部含摘类 → 回流 → 挂类）
          startCursorBlink(cursor);
        }
      },
    );
  }

  function runInitTW() {
    initTypewriter();
    setTimeout(initTypewriter, 220);
  }

  // document 级监听器只绑一次：本脚本会被 SwupScriptsPlugin 在每次换页时克隆
  // 重执行（banner 元素在 Swup 容器外跨页持久，打字机/光标状态存于元素
  // __twInstance/__blinkInterval 字段，监听器操作的是同一持久元素）。
  // 不守卫则监听器逐次累积；换页后的重初始化由下方 runInitTW() 承担。
  // 原 swup:contentReplaced 监听删除：Swup v3 事件名，v4 分发 swup:{hook}，从未触发。
  if (!guardOnce("banner-tw")) {
    // I24：后台标签页暂停（打字链 + 光标闪烁；打字机状态存实例字段 __twInstance、
    // 光标状态是持久元素上的 .banner-cursor-blink 类，回前台都接着原状态继续。
    // 对照 banner-drop.js visibilitychange 守卫，动画本体不变）
    document.addEventListener("visibilitychange", function () {
      var subtitle = document.getElementById("banner-subtitle");
      var cursor = document.getElementById("banner-cursor");
      if (document.hidden) {
        if (
          subtitle &&
          subtitle.__twInstance &&
          subtitle.__twInstance.timeoutId
        ) {
          clearTimeout(subtitle.__twInstance.timeoutId);
          subtitle.__twInstance.timeoutId = null;
        }
        if (cursor && cursor.classList.contains(BLINK_CLASS)) {
          stopCursorBlink(cursor);
        }
      } else {
        if (
          subtitle &&
          subtitle.__twInstance &&
          !subtitle.__twInstance.timeoutId
        ) {
          subtitle.__twInstance.type();
        }
        if (cursor && !cursor.classList.contains(BLINK_CLASS)) {
          startCursorBlink(cursor);
        }
      }
    });

    document.addEventListener("banner:visible", runInitTW);
  }

  // P1（1.2.86）：打字机为 banner 副标题装饰，首屏 home 初始加载不依赖
  // banner:visible（仅 Swup 从非首页回首页才分发），把初始同步初始化推到
  // 主线程空闲（requestIdleCallback），削减首屏 load 期同步主线程工作（TBT）；
  // banner:visible 监听器保留，Swup 导航回首页时照常触发
  onIdle(runInitTW);
})();
