# SeMo3D 项目主页

静态学术项目页，包含论文介绍、选择性建模交互示意、智能体建模链、视频对比与可旋转的 3D 结果。页面和资源均可独立部署。

## 页面设计

- 蓝色 `#355E8B` 与橙色 `#D9864A` 为主题色，对应浅底、高亮、边框与体素明暗由主色派生，使用暖灰背景、白色内容卡片和衬线字体。
- 首屏展示项目标识、论文标题、命名解释与资源入口。命名解释为斜体，Se、Mo 与对应词首使用主题色。
- 正文依次为 Abstract、Key Insight、Explore Selective Modeling、Method、Agentic 3D Modeling、Comparison、Citation；引用信息使用待补充的 arXiv 占位说明。
- 选择性建模使用积木示意，默认生成模式、自动旋转；编辑和补全各有三个示例，支持合成、暂停与进度拖拽。
- 智能体建模使用浅黄色主题，窗口名为 3D Modeling Workflows，包含 20 条生成→编辑链和 20 条补全→编辑链。每条链一行四列：图像或残缺点云输入、生成或补全结果、两次编辑结果，共 120 个结果模型。模型默认同步自动旋转，也可拖拽或重置视角；每个资产右上角提供下载按钮。输入图像使用与结果区相同的黑框和阴影。四列随窗口宽度缩放，不使用横向滚动；窄屏将简短提示放在模型下方。编辑参考图和编辑区域不展示。
- 工作流采用与结果区一致的整块浅色 3D 舞台，不给每个资产单独加装饰边框。旋转、重置按钮位于舞台内部底部，预留 48px 工具栏空间，距底边 10px；收紧模型下方留白，让控制按钮靠近资产。舞台下方使用缩略图轮播切换案例，不加分割线，提供前后切换箭头与键盘操作，当前缩略图自动滚入可见范围。生成案例显示输入图像，补全案例显示残缺点云，并标明当前案例序号。模型仅在选中对应链后加载。窗口下方说明 SeMo3D 能够作为智能体的统一建模工具，通过自然语言交互实现高效 3D 创建。
- 界面按层级共用圆角参数：章节卡片 18px、浅色面板 16px、白色内框 14px、3D 舞台 12px、控制按钮 8px。普通容器不加额外外边框；交互按钮保留 1px 边框，图像条件保留黑色 2px 边框与阴影。
- Teaser 使用 3840×2160 的 4K 视频，自动播放，无播放控件，每轮结束后停留最后一帧一秒再重播；离开可视区域时暂停。项目 Logo 及浏览器图标使用透明立方体标识。
- 结果区按生成、编辑、补全和多模态控制分组。图像、文本、点条件与结果清晰对应，视频自动同步循环播放且不显示播放控件，3D 模型支持旋转和下载。三个交互章节沿用 Comparison 的浅色展台、白色内框、标签页和控制按钮样式。
- Comparison 的交互式结果包含生成 12 例、编辑 12 例、补全 8 例、多模态 6 组。视频每组保留 4 例。未保留的交互式案例及其独立资产已从发布目录移除。
- 补全对比视频中的 `SeMo3D†` 与 `HY3D-Omni†` 使用相同符号，窗口下方脚注说明 `† With additional sparse point guidance.`。
- 页面适配桌面与手机，使用本地资源，不加载外部统计脚本。

## 本地预览

在本目录运行：

```bash
python serve.py
```

浏览器打开 `http://localhost:8000`。3D 查看器需要 HTTP 服务，不能直接双击 HTML 文件。

## 展示配置

修改 `static/js/display-config.js`，保存后刷新页面：

- `models` / `videos` 分别控制交互式结果和对比视频。
- `gen` / `edit` / `comp` / `multi` 对应四组结果。
- `order` 调整案例顺序；`hidden` 隐藏案例。从 `order` 删除 ID 不会隐藏案例。
- `multimodalPrompts` 统一管理多模态文字，同步更新视频、3D 说明和面板提示。每组四条按结果编号排列，视频和交互式中的同一案例共用文案。
- `videoAutoAdvanceMs` 为 `0` 时手动切换案例。

其余结果的文本位于 `static/js/data.js` 和 `static/js/video-layout.js`；积木示意的文本位于 `static/js/explore.js`；智能体建模链的图像、模型和箭头提示位于 `static/js/agent-data.js`，其中 `displayPrompt` 为页面使用的简短提示。

## 发布信息

在 `index.html` 中填写：

1. 作者和机构：在 `.authors`、`.affils`、`.correspondence` 中维护姓名、链接和通讯作者标记。
2. 资源链接：填写 ArXiv、Code、Model 的 `href`，移除已开放链接的 `data-soon`、`aria-disabled` 和 `title`。全部开放后删除 `.resource-status`。
3. 引用：更新 Citation 中的 `#bibtex-code` 和 `.citation-note`，论文公开后补充正式年份、arXiv 编号与链接。
4. 分享预览：将 `og:image` 改为部署后的完整图片地址。

发布本目录的内容，包含 `.nojekyll` 和全部静态资源。构建工具、检查记录与本地备份不属于发布目录。


## 文件与依赖

- `static/css/`：布局与样式。
- `static/js/`：页面交互、展示配置、结果数据和 3D 查看器。
- `static/images/`、`static/videos/`：图片与视频。
- `static/models/`：站内展示模型；完整下载文件由 Releases 托管。
- `static/vendor/three/`：本地 three.js，保留 MIT 许可。

ArXiv 图标使用 Simple Icons 的 CC0 图标。

## 托管信息

- 页面地址：https://xiaokunsun.github.io/SeMo3D.github.io/
- 完整下载资源：[page-assets-v1](https://github.com/XiaokunSun/SeMo3D.github.io/releases/tag/page-assets-v1)。
- 本目录可直接作为 Pages 发布根目录，展示模型保存在站内，完整下载资源的按钮链接指向 Releases。
- 本地预览需要先完成 Release 附件上传，外部下载按钮才能正常下载。
