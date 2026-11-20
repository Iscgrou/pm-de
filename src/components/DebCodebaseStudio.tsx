import { useEffect, useMemo, useState } from 'react';
import { Copy, Check, FileCode2, Search, Terminal } from 'lucide-react';
import type { DebFileEntry } from '../engine/types';

export function DebCodebaseStudio() {
  const [files, setFiles] = useState<DebFileEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [totalLines, setTotalLines] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [subsystemFilter, setSubsystemFilter] = useState<string>('ALL');
  const [copied, setCopied] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const buildCommands = `tar -xzf payam-xauusd-ubuntu-source.tar.gz && cd payam-xauusd-ubuntu-deb
chmod +x build-deb.sh && ./build-deb.sh
sudo dpkg -i dist/xauusd-aurum-deck_2.0.0_amd64.deb && sudo apt-get install -f
xauusd-aurum-deck verify   # Runs institutional self-verification gates on Ubuntu`;

  useEffect(() => {
    let active = true;
    fetch('/api/deb/tree')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!active) return;
        setFiles(data.files ?? []);
        setTotalBytes(data.totalBytes ?? 0);
        setTotalLines(data.totalLines ?? 0);
        const preferred =
          (data.files as DebFileEntry[]).find((f) => f.path.endsWith('DEBIAN/control')) ??
          data.files?.[0];
        if (preferred) setSelectedPath(preferred.path);
        setLoadingTree(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load Ubuntu .deb source tree');
        setLoadingTree(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    let active = true;
    setLoadingFile(true);
    fetch(`/api/deb/file?path=${encodeURIComponent(selectedPath)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!active) return;
        setContent(data.content ?? '');
        setLoadingFile(false);
      })
      .catch((err) => {
        if (!active) return;
        setContent(`# Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setLoadingFile(false);
      });
    return () => {
      active = false;
    };
  }, [selectedPath]);

  const subsystems = useMemo(() => {
    return ['ALL', ...Array.from(new Set(files.map((f) => f.subsystem)))];
  }, [files]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (subsystemFilter !== 'ALL' && f.subsystem !== subsystemFilter) return false;
      if (!q) return true;
      return f.path.toLowerCase().includes(q) || f.subsystem.toLowerCase().includes(q);
    });
  }, [files, search, subsystemFilter]);

  const groupedFiles = useMemo(() => {
    const map = new Map<string, DebFileEntry[]>();
    for (const f of filteredFiles) {
      const list = map.get(f.subsystem) ?? [];
      list.push(f);
      map.set(f.subsystem, list);
    }
    return Array.from(map.entries());
  }, [filteredFiles]);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div dir="ltr" className="max-w-[1600px] mx-auto px-4 lg:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-white/8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-100">
            Ubuntu .deb Full-Stack Source Package
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Complete uncompiled Debian package tree (<span className="font-mono text-slate-300">DEBIAN/control</span>, maintainer scripts, <span className="font-mono text-slate-300">systemd</span> service, desktop launcher, and all 8 Python/FastAPI/SQLite/FastMCP subsystems).
          </p>
        </div>

        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildCommands);
              setCopiedCmd(true);
              setTimeout(() => setCopiedCmd(false), 1800);
            } catch {
              setCopiedCmd(false);
            }
          }}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium border border-white/12 text-slate-200 hover:bg-white/6 transition-colors whitespace-nowrap shrink-0"
        >
          {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedCmd ? 'Build Commands Copied' : 'Copy Ubuntu Build Commands'}
        </button>
      </div>

      {/* Ubuntu Build Instructions Strip */}
      <section
        aria-label="Ubuntu dpkg-deb build commands"
        className="rounded-lg border border-white/8 bg-[#111827] p-4 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-200 font-display font-semibold">
            <Terminal className="w-4 h-4 text-[#D4A853]" />
            Build & Install on Ubuntu Desktop / Server
          </div>
          <div className="font-mono text-slate-400 tabular-nums" data-testid="deb-tree-stats">
            {files.length} source files · {totalLines.toLocaleString()} lines · {(totalBytes / 1024).toFixed(1)} KB
          </div>
        </div>
        <pre className="p-3 rounded bg-[#0B0F17] border border-white/6 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
          {buildCommands}
        </pre>
      </section>

      {error && (
        <div role="alert" className="p-4 rounded-lg border border-red-500/30 bg-red-950/20 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Split Explorer: File Tree + Source Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left Sidebar Tree */}
        <aside className="lg:col-span-4 rounded-lg border border-white/8 bg-[#111827] flex flex-col max-h-[680px]">
          <div className="p-3 border-b border-white/8 space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter Debian & Python files..."
                aria-label="Filter source files"
                className="w-full pl-8 pr-3 py-1.5 rounded bg-[#0B0F17] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#D4A853]"
              />
            </div>
            <select
              value={subsystemFilter}
              onChange={(e) => setSubsystemFilter(e.target.value)}
              aria-label="Filter by subsystem"
              className="w-full px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-[#D4A853]"
            >
              {subsystems.map((sub) => (
                <option key={sub} value={sub}>
                  {sub === 'ALL' ? 'All Subsystems' : sub}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-3" data-testid="deb-file-list">
            {loadingTree ? (
              <p className="text-xs text-slate-400 p-3">Scanning Ubuntu .deb package directory...</p>
            ) : groupedFiles.length === 0 ? (
              <p className="text-xs text-slate-400 p-3">No files match "{search}".</p>
            ) : (
              groupedFiles.map(([subsystem, list]) => (
                <div key={subsystem} className="space-y-0.5">
                  <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">
                    {subsystem} · {list.length}
                  </div>
                  {list.map((f) => {
                    const active = f.path === selectedPath;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => setSelectedPath(f.path)}
                        className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                          active
                            ? 'bg-[#D4A853]/15 text-[#E5BF70]'
                            : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          <span className="truncate">{f.name}</span>
                        </span>
                        <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                          {f.lines}L
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Right Code Viewer */}
        <section
          aria-label="Source file viewer"
          className="lg:col-span-8 rounded-lg border border-white/8 bg-[#111827] flex flex-col max-h-[680px] overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-white/8 bg-[#0E1420] flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-slate-200 truncate" data-testid="selected-deb-path">
              {selectedPath || 'Select a file'}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!content}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-white/10 text-slate-200 hover:bg-white/6 transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy File'}
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-[#0B0F17] p-4">
            {loadingFile ? (
              <p className="font-mono text-xs text-slate-500">Loading source file...</p>
            ) : (
              <pre className="font-mono text-xs leading-relaxed text-slate-200 whitespace-pre" data-testid="deb-code-viewer">
                {content}
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
