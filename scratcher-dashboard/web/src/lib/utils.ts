/*
  shadcn/ui 通用工具函数
  设计：shadcn 组件靠 cn 合并 tailwind class，clsx 处理条件 class，tailwind-merge 去重冲突 class。
  调用示例：cn('px-2 py-1', isActive && 'bg-primary', className)
*/

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn 接收任意个 class 字符串或条件对象，返回去重后的合并 class 串
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
