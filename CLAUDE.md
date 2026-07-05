# 项目概述

本项目是一个为 Scratcher（使用Scratch 编程的开发者） 提供数据分析基座的scratch拓展。
项目初衷是建设一个For Developer的脚手架，帮助他们更快、更方便、更直观地构建一个大数据分析系统，以帮助他们以数据为基座改进游戏。
“玩家数据分析”拓展，比如说点赞收藏关注的时机，然后回头率之类的。

# 项目架构

本项目分为拓展端和开发者端。
拓展端位于根目录，采用scratch-ext这个scratch extension开发脚手架；
开发者端面向scratcher，用于将他们的作品的数据展现给他们。scratcher根据在使用拓展时拓展提供给他们的唯一id进入对应的开发者端的数据分析dashboard。开发者端位于 /scratcher-dashboard

# 技术栈

### 拓展端

脚手架对应技术栈
TS + tsup

### Scratcher端(dashboard端/开发者端)

##### 前端

React Router + React + Shadcn/ui

##### 后端

python fastapi
ORM：Prisma
数据库：postgresql + redis

# 其他说明

为了便于计算回头率等基于用户身份的数据，对于用户身份的认定可以使用如下方式：

```
userinfo = await runtime.ccwAPI.getUserInfo()   //runtime为拓展加载时会得到的参数，具体以scratch的设计为准。这可能在vm的类型定义中没有呈现，但这是绝对正确的写法，照样写即可。
useruuid = userinfo.uuid
```
