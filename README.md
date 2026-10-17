# claude-mods

Claude Code 的兩個 mod：

- **file-log**：右側面板列出這次對話修改與新增的檔案，也能查看今天所有對話的紀錄（只保留當天）。內含貪食蛇和小恐龍小遊戲。
- **zh-translate**：按一下「中文」按鈕或輸入 `/zh`，Claude 的回覆和選擇題都會變成繁體中文（只翻譯最新一則回覆）。

## 安裝

在終端機的 Claude Code 對話框輸入：

```
/plugin install file-log --marketplace justin20745413/claude-mods
/plugin install zh-translate --marketplace justin20745413/claude-mods
```

第一次會問 `Add marketplace?`，按 `y`；接著選安裝範圍，直接按 Enter（user）即可。

在一般終端機（shell）裡：

```
claude plugin install file-log --marketplace justin20745413/claude-mods
claude plugin install zh-translate --marketplace justin20745413/claude-mods
```

在桌面版 App（`/plugin` 不能用時）：點對話框旁的 **+** → **Plugins** → **Add marketplace**，輸入 `justin20745413/claude-mods`，再按 **Add plugin**。
