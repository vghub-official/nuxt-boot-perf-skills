# Nuxt 冷启动与首屏阶段（摘要）

详细量级与日志顺序建议在**业务仓库**自维护的专题文档中编写，并与本技能 `references` 交叉引用（可选）。

## SSR（首字节 HTML）

1. Nitro / 服务端中间件  
2. Nuxt `*.server` 插件  
3. 根组件 `app.vue` 在服务端 setup（含可能 **阻塞** 的 `await useAsyncData`）  
4. 页面 setup、`@nuxt/content` 等  
5. 输出 HTML  

**要点**：多数「分钟级」体感延迟不在 SSR 本身，而在浏览器侧。

## CSR / Hydration（用户感知「页面活了」）

- 文档与入口脚本（dev 下 Vite 与体积会放大耗时）  
- 客户端插件链  
- 路由与壳、`app:beforeMount`  
- 根组件客户端 setup（`useAsyncData` 可能 lazy）  
- 布局与首屏子树 chunk 拉取与执行  
- 路由页 setup、根 `onMounted`、Suspense / 异步子树  

**要点**：`app:mounted` 很早但页面 `onMounted` 很晚时，优先查 **布局 chunk、常驻重弹窗、大依赖、Content/MDC、DevTools**。

## 决策提示

- **bootstrap 日志很快、根 `onMounted` 极慢**：多为 **布局与 chunk 段**，而非 Pinia 门控本身写错。  
- **服务端 `asyncData` 很慢**：再查是否误在服务端阻塞、未使用 `lazy` 等。
