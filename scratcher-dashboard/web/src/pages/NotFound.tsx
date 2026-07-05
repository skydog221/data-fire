/*
  404 页面
  设计：访问非 /p/:projectId 的路径时显示。给一个返回提示，不报错不崩溃。
*/

import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <p className="text-lg text-muted-foreground">这个页面不存在。看板地址格式是 /p/作品ID</p>
      <Link to="/p/demo">
        <Button variant="outline">看示例看板</Button>
      </Link>
    </div>
  )
}
