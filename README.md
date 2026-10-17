# claude-mods

Claude Code 的兩個 mod：

- **file-log**：右側面板列出這次對話修改與新增的檔案，也能查看今天所有對話的紀錄（只保留當天）。內含貪食蛇和小恐龍小遊戲。
- **zh-translate**：按一下「中文」按鈕或輸入 `/zh`，Claude 的回覆和選擇題都會變成繁體中文（只翻譯最新一則回覆）。

## 一次安裝全部

在終端機的 Claude Code 對話框輸入：

```
/plugin install all --marketplace justin20745413/claude-mods
```

第一次會問 `Add marketplace?`，按 `y`；接著選安裝範圍，直接按 Enter（user）即可。file-log 和 zh-translate 會一起裝好。

在一般終端機（shell）裡：

```
claude plugin install all --marketplace justin20745413/claude-mods
```

## 一次安裝全部工具，不要小遊戲

```
/plugin install no-game --marketplace justin20745413/claude-mods
```

會裝 file-log-nogame 和 zh-translate。file-log-nogame 跟 file-log 功能一樣，但不含貪食蛇和小恐龍，面板上也沒有 game 分頁。（file-log 和 file-log-nogame 選一個裝就好。）

## 只裝其中一個

```
/plugin install file-log --marketplace justin20745413/claude-mods
/plugin install file-log-nogame --marketplace justin20745413/claude-mods
/plugin install zh-translate --marketplace justin20745413/claude-mods
```

在桌面版 App（`/plugin` 不能用時）：點對話框旁的 **+** → **Plugins** → **Add marketplace**，輸入 `justin20745413/claude-mods`，再按 **Add plugin**，選 `all` 或單一個 mod。

## 更新

裝過的人要拿到新版本：

```
claude plugin marketplace update my-mods
claude plugin update file-log@my-mods
claude plugin update zh-translate@my-mods
```

（裝的是無遊戲版的話，把 `file-log@my-mods` 換成 `file-log-nogame@my-mods`。）

## 給維護者

`file-log-nogame` 是由 `file-log` 自動產生的，不要直接改它。改完 `file-log` 後執行：

```
./scripts/make-nogame.sh
```
