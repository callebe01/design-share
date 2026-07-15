// DesignShare menu bar app — thin native shell over the design-share Node daemon.
// The menu bar IS the branch list (wireframe 4b). All real logic lives in the
// npm package; this app keeps daemons alive and renders /api/board.

import AppKit
import ServiceManagement

struct RepoEntry {
    let root: String
    let port: Int
    let name: String
    let nodePath: String?
    let cliPath: String?
    let keepAlive: Bool
}

struct RepoStatus {
    var entry: RepoEntry
    var board: [String: Any]?
    var failCount: Int = 0
    var lastRespawn: Date = .distantPast
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var statusItem: NSStatusItem!
    let menu = NSMenu()
    var repos: [String: RepoStatus] = [:]
    var timer: Timer?

    let registryURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".design-share/daemons.json")

    // The design-share mark: a rounded board with a knocked out center,
    // matching the dashboard's logo. Template image so macOS tints it for
    // light/dark menu bars and the disabled state.
    static func makeIcon() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            let path = NSBezierPath(roundedRect: NSRect(x: 2, y: 2.5, width: 13.5, height: 13.5), xRadius: 4.2, yRadius: 4.2)
            path.append(NSBezierPath(roundedRect: NSRect(x: 6.4, y: 6.9, width: 4.7, height: 4.7), xRadius: 1.6, yRadius: 1.6))
            path.windingRule = .evenOdd
            NSColor.black.setFill()
            path.fill()
            return true
        }
        image.isTemplate = true
        return image
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = Self.makeIcon()
            button.imagePosition = .imageLeft
        }
        menu.delegate = self
        statusItem.menu = menu

        tick()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    // MARK: - polling

    func loadRegistry() -> [RepoEntry] {
        guard let data = try? Data(contentsOf: registryURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reposDict = json["repos"] as? [String: Any] else { return [] }
        var entries: [RepoEntry] = []
        for (root, value) in reposDict {
            guard let d = value as? [String: Any], let port = d["port"] as? Int else { continue }
            entries.append(RepoEntry(
                root: root,
                port: port,
                name: d["name"] as? String ?? (root as NSString).lastPathComponent,
                nodePath: d["nodePath"] as? String,
                cliPath: d["cliPath"] as? String,
                keepAlive: d["keepAlive"] as? Bool ?? true
            ))
        }
        return entries.sorted { $0.name < $1.name }
    }

    func tick() {
        let entries = loadRegistry()
        let known = Set(entries.map { $0.root })
        repos = repos.filter { known.contains($0.key) }
        for entry in entries {
            if repos[entry.root] == nil { repos[entry.root] = RepoStatus(entry: entry) }
            repos[entry.root]?.entry = entry
            poll(entry)
        }
        if entries.isEmpty { updateBadge() }
    }

    func poll(_ entry: RepoEntry) {
        guard let url = URL(string: "http://localhost:\(entry.port)/api/board") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self, var status = self.repos[entry.root] else { return }
                if let data,
                   let board = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   board["repo"] != nil {
                    status.board = board
                    status.failCount = 0
                } else {
                    status.failCount += 1
                    status.board = status.failCount > 2 ? nil : status.board
                    self.maybeRespawn(&status)
                }
                self.repos[entry.root] = status
                self.updateBadge()
            }
        }.resume()
    }

    func maybeRespawn(_ status: inout RepoStatus) {
        let e = status.entry
        guard status.failCount >= 2, e.keepAlive,
              let nodePath = e.nodePath, let cliPath = e.cliPath,
              Date().timeIntervalSince(status.lastRespawn) > 20,
              FileManager.default.fileExists(atPath: e.root) else { return }
        status.lastRespawn = Date()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: nodePath)
        p.arguments = [cliPath, "--daemon", "--port", String(e.port)]
        p.currentDirectoryURL = URL(fileURLWithPath: e.root)
        var env = ProcessInfo.processInfo.environment
        let nodeDir = (nodePath as NSString).deletingLastPathComponent
        env["PATH"] = "\(nodeDir):/usr/local/bin:/opt/homebrew/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        p.environment = env
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
    }

    // MARK: - badge

    func openRequestsForMe(_ board: [String: Any]) -> [[String: Any]] {
        guard let me = board["me"] as? [String: Any], let slug = me["slug"] as? String else { return [] }
        let requests = (board["requests"] as? [[String: Any]]) ?? []
        return requests.filter { r in
            (r["toUser"] as? String) == slug && (r["resolvedAt"] == nil || r["resolvedAt"] is NSNull)
        }
    }

    func unreadCount(_ board: [String: Any]) -> Int {
        guard let me = board["me"] as? [String: Any], let slug = me["slug"] as? String else { return 0 }
        let shares = (board["shares"] as? [[String: Any]]) ?? []
        let myBranches = Set(shares.compactMap { s -> String? in
            (s["user"] as? String) == slug ? s["branch"] as? String : nil
        })
        let comments = (board["comments"] as? [[String: Any]]) ?? []
        let unreadComments = comments.filter { c in
            c["resolvedAt"] == nil || c["resolvedAt"] is NSNull
        }.filter { c in
            (c["user"] as? String) != slug && myBranches.contains((c["branch"] as? String) ?? "")
        }.count
        return unreadComments + openRequestsForMe(board).count
    }

    func updateBadge() {
        let total = repos.values.compactMap { $0.board }.map { unreadCount($0) }.reduce(0, +)
        let anyAlive = repos.values.contains { $0.board != nil }
        if let button = statusItem.button {
            button.title = total > 0 ? " \(total)" : ""
            button.appearsDisabled = !anyAlive
        }
    }

    // MARK: - menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let ordered = repos.values.sorted { $0.entry.name < $1.entry.name }

        if ordered.isEmpty {
            let hint = NSMenuItem(title: "No boards yet — run npx design-share in a repo", action: nil, keyEquivalent: "")
            hint.isEnabled = false
            menu.addItem(hint)
        }

        for status in ordered {
            addRepoSection(menu, status)
        }

        menu.addItem(.separator())
        let login = NSMenuItem(title: "Launch at login", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        if #available(macOS 13.0, *) {
            login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        } else {
            login.isEnabled = false
        }
        menu.addItem(login)
        let quit = NSMenuItem(title: "Quit DesignShare", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    func addRepoSection(_ menu: NSMenu, _ status: RepoStatus) {
        let e = status.entry
        if menu.items.count > 0 { menu.addItem(.separator()) }

        guard let board = status.board else {
            let dead = NSMenuItem(title: "\(e.name) — restarting…", action: nil, keyEquivalent: "")
            dead.isEnabled = false
            menu.addItem(dead)
            return
        }

        let me = (board["me"] as? [String: Any])?["slug"] as? String ?? ""
        let ownBranch = board["ownBranch"] as? String
        let shares = (board["shares"] as? [[String: Any]]) ?? []
        let comments = (board["comments"] as? [[String: Any]]) ?? []
        let previews = (board["previews"] as? [String: Any]) ?? [:]

        let header = NSMenuItem(title: "\(e.name) — localhost:\(e.port)", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)

        for r in openRequestsForMe(board) {
            guard let branch = r["branch"] as? String else { continue }
            let who = (r["fromName"] as? String) ?? (r["fromUser"] as? String) ?? "someone"
            let item = NSMenuItem(title: "\(who) asked you: \(branch)", action: #selector(openLink(_:)), keyEquivalent: "")
            item.target = self
            if let img = NSImage(systemSymbolName: "eye", accessibilityDescription: "review request") {
                item.image = img
            }
            let owner = shares.first { ($0["branch"] as? String) == branch }?["user"] as? String ?? me
            item.representedObject = "http://localhost:\(e.port)/#/u/\(owner)/\(branch)"
            menu.addItem(item)
        }

        if let own = ownBranch {
            let key = "\(me)/\(own)"
            let prev = previews[key] as? [String: Any]
            let state = (prev?["status"] as? String) == "ready" ? "live" : "starting"
            let item = NSMenuItem(title: "you · \(own) · \(state)", action: #selector(openLink(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = "http://localhost:\(e.port)/#/u/\(me)/\(own)"
            menu.addItem(item)
        }

        let team = shares.filter { ($0["user"] as? String) != me && ($0["active"] as? Bool ?? false) }
        if !team.isEmpty {
            let label = NSMenuItem(title: "Team branches", action: nil, keyEquivalent: "")
            label.isEnabled = false
            menu.addItem(label)
            for share in team {
                guard let user = share["user"] as? String, let branch = share["branch"] as? String else { continue }
                let name = share["name"] as? String ?? user
                let open = comments.filter { c in
                    ((c["branch"] as? String) == branch) && (c["resolvedAt"] == nil || c["resolvedAt"] is NSNull)
                }.count
                var title = "\(name) · \(branch)"
                if open > 0 { title += " · \(open) open" }
                let item = NSMenuItem(title: title, action: #selector(openLink(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = "http://localhost:\(e.port)/#/u/\(user)/\(branch)"
                menu.addItem(item)
            }
        }

        let dash = NSMenuItem(title: "Open dashboard", action: #selector(openLink(_:)), keyEquivalent: "")
        dash.target = self
        dash.representedObject = "http://localhost:\(e.port)"
        menu.addItem(dash)

        let copy = NSMenuItem(title: "Copy npx snippet", action: #selector(copySnippet(_:)), keyEquivalent: "")
        copy.target = self
        copy.representedObject = "Design previews for \(e.name): run npx design-share inside the repo"
        menu.addItem(copy)
    }

    // MARK: - actions

    @objc func openLink(_ sender: NSMenuItem) {
        if let s = sender.representedObject as? String, let url = URL(string: s) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func copySnippet(_ sender: NSMenuItem) {
        if let s = sender.representedObject as? String {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(s, forType: .string)
        }
    }

    @objc func toggleLogin() {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            do {
                if service.status == .enabled { try service.unregister() }
                else { try service.register() }
            } catch { NSLog("launch at login toggle failed: \(error)") }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
