/*
  data-fire dashboard 前端入口
  设计思想：HOP 要求入口只负责"接收外部触发"。这里是浏览器加载页面这个触发，
  入口把 React 树挂到 #root，并套上 BrowserRouter 让 react-router 接管 URL 路由。
  后续所有页面跳转都是路由触发，页面内部的数据拉取由各页面自己处理。
  调用：浏览器访问任意路径 → BrowserRouter 匹配 App.tsx 里的路由表 → 渲染对应页面。
*/

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// createRoot 是 React 18 的挂载 API，挂一次就够。StrictMode 在开发期帮发现副作用问题。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
