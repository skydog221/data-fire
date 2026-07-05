/*
  shadcn/ui Skeleton 骨架屏组件
  设计：加载中时用占位灰块代替内容，给用户"内容正在加载"的视觉反馈，避免空白闪烁。
  调用示例：<Skeleton className="h-4 w-24" />  画一个 4 高 24 宽的灰条
*/

import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
