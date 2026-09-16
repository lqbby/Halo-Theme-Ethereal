#!/usr/bin/env node
/**
 * fetchWithTimeout 行为回归（bug-hunter 第 13 轮）。
 *
 * 被测对象是 TS 源（Node 22 的类型剥离直跑）：`node --experimental-strip-types scripts/test-fetch-timeout.mjs`
 *
 * 要证明的核心不变量（都是「接口挂住」这类真实故障下的行为）：
 *   [1] 正常响应直通 —— 同一个 Response 对象返回，不吞不改
 *   [2] 挂住的请求必须**在超时后 reject**（AbortError），而不是永远 pending
 *       —— 对照组：同样的 stub 直接用裸 fetch ⇒ 300ms 后仍未 settle（这就是缺陷机制：
 *          挂在后面的 .catch/.finally 永不执行 ⇒ 按钮永久 disabled / 小组件永久「加载中」）
 *   [3] 成功后要清掉定时器：已 resolve 的请求不得随后又被 abort
 *   [4] init 原样传递（method / headers / body / credentials）
 *   [5] timeoutMs<=0 表示不超时：不得注入 signal
 *   [6] 缺省超时常量 = 10000ms（与 list-filter.ts 的 FETCH_TIMEOUT 同量级）
 */
import assert from "node:assert/strict";

const { fetchWithTimeout, FETCH_TIMEOUT_MS } =
  await import("../src/utils/fetch-timeout.ts");

let pass = 0;
const fails = [];
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${label}`);
  } catch (e) {
    fails.push(label);
    console.log(`  ✗ ${label}  → ${e && e.message}`);
  }
}

const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 可编程的 fetch 桩：记录调用、按需挂住 */
function stubFetch(behavior) {
  const calls = [];
  globalThis.fetch = (input, init) => {
    calls.push({ input, init });
    if (behavior === "hang") {
      return new Promise((_res, rej) => {
        const sig = init && init.signal;
        if (sig) {
          sig.addEventListener("abort", () => {
            const e = new Error("The operation was aborted.");
            e.name = "AbortError";
            rej(e);
          });
        }
      });
    }
    if (behavior === "throw") throw new TypeError("Failed to fetch");
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  return calls;
}

console.log(
  `被测：src/utils/fetch-timeout.ts（缺省超时 ${FETCH_TIMEOUT_MS}ms）\n`,
);

console.log("[1] 正常响应直通");
await check("返回的是同一个 Response（不吞不改）", async () => {
  stubFetch("ok");
  const res = await fetchWithTimeout("/x");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "{}");
});

console.log("[2] 挂住的请求必须在超时后 reject");
await check("对照组：裸 fetch 挂住 300ms 仍不 settle（缺陷机制）", async () => {
  stubFetch("hang");
  let settled = false;
  realFetch === undefined; // 说明用桩
  fetch("/hang")
    .then(() => (settled = true))
    .catch(() => (settled = true));
  await sleep(300);
  assert.equal(settled, false, "裸 fetch 竟然 settle 了？");
});
await check("fetchWithTimeout 30ms 内以 AbortError reject", async () => {
  stubFetch("hang");
  const t0 = Date.now();
  let err = null;
  try {
    await fetchWithTimeout("/hang", {}, 30);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "没有 reject");
  assert.equal(err.name, "AbortError");
  assert.ok(Date.now() - t0 < 500, `耗时 ${Date.now() - t0}ms`);
});

console.log("[3] 成功后清定时器：不得随后再 abort");
await check("resolve 后 100ms 内 signal 未被 abort", async () => {
  const calls = stubFetch("ok");
  const res = await fetchWithTimeout("/x", {}, 50);
  assert.equal(res.status, 200);
  const sig = calls[0].init.signal;
  await sleep(120);
  assert.equal(sig.aborted, false, "定时器没被清掉，成功请求被误 abort");
});

console.log("[4] init 原样传递");
await check("method/headers/body/credentials 都送进 fetch", async () => {
  const calls = stubFetch("ok");
  await fetchWithTimeout("/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"a":1}',
    credentials: "same-origin",
  });
  const init = calls[0].init;
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/json" });
  assert.equal(init.body, '{"a":1}');
  assert.equal(init.credentials, "same-origin");
  assert.ok(init.signal, "缺省应注入 signal 用于超时");
});

console.log("[5] timeoutMs<=0 = 不超时");
await check(
  "timeoutMs=0 时不注入 signal（交给调用方/浏览器默认）",
  async () => {
    const calls = stubFetch("ok");
    await fetchWithTimeout("/x", { method: "GET" }, 0);
    assert.equal(calls[0].init.signal, undefined);
  },
);

console.log("[6] 缺省常量");
await check("FETCH_TIMEOUT_MS = 10000（与 list-filter 同量级）", () => {
  assert.equal(FETCH_TIMEOUT_MS, 10000);
});

globalThis.fetch = realFetch;
console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);
