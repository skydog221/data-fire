/*
  data-fire dashboard 路由表
  设计思想：HOP 里这是"触发入口→分发到哪个页面"。URL 是触发源，路由表决定哪条路径渲染哪个页面。
  路由清单：
    /p/:projectId -> Dashboard  某作品的数据看板主页，projectId 是拓展分配的作品 id
    *             -> NotFound   任何其它路径都进 404 页
  看板页自己再根据用户操作（切 tab、输入 metric 名）触发各自的 api 指令拉数据。
*/

import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/p/:projectId" element={<Dashboard />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
