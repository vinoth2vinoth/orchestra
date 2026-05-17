import React, { useState, useEffect, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { Folder, FolderOpen, FileText, FileCode, FileJson, Image as ImageIcon, ChevronRight, ChevronDown, Plus, Trash2, Save, File, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
};

export function ProjectWorkspace() {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/workspace/files');
      if (res.ok) {
        const data = await res.json();
        setNodes(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (!selectedFilePath) return;
    const fetchContent = async () => {
      try {
        const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(selectedFilePath)}`);
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content);
          setOriginalContent(data.content);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchContent();
  }, [selectedFilePath]);

  const handleSave = async () => {
    if (!selectedFilePath || isSaving) return;
    setIsSaving(true);
    try {
      await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFilePath, content: fileContent })
      });
      setOriginalContent(fileContent);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateFile = async (dirPath: string) => {
    const name = prompt('Enter file name:');
    if (!name) return;
    const newPath = dirPath ? `${dirPath}/${name}` : name;
    try {
      await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, content: '' })
      });
      fetchFiles();
      setSelectedFilePath(newPath);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateDirectory = async (dirPath: string) => {
    const name = prompt('Enter folder name:');
    if (!name) return;
    const newPath = dirPath ? `${dirPath}/${name}` : name;
    try {
      await fetch('/api/workspace/dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath })
      });
      fetchFiles();
      setExpandedDirs(new Set(expandedDirs).add(newPath));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`Are you sure you want to delete ${path}?`)) return;
    try {
      await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      if (selectedFilePath === path) {
        setSelectedFilePath(null);
        setFileContent('');
      }
      fetchFiles();
    } catch (err) {
      console.error(err);
    }
  };

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx': return <FileCode className="w-4 h-4 text-yellow-400" />;
      case 'json': return <FileJson className="w-4 h-4 text-green-400" />;
      case 'html': return <FileCode className="w-4 h-4 text-orange-400" />;
      case 'css': return <FileCode className="w-4 h-4 text-blue-400" />;
      case 'md': return <FileText className="w-4 h-4 text-blue-300" />;
      case 'png':
      case 'jpg':
      case 'svg': return <ImageIcon className="w-4 h-4 text-purple-400" />;
      default: return <File className="w-4 h-4 text-slate-400" />;
    }
  };

  const getLanguageExtension = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx': return [javascript({ jsx: true, typescript: true })];
      case 'json': return [json()];
      case 'html': return [html()];
      case 'css': return [css()];
      default: return [];
    }
  };

  const renderTree = (nodeList: FileNode[], level = 0) => {
    return nodeList.map((node) => {
      const isExpanded = expandedDirs.has(node.path);
      const isSelected = selectedFilePath === node.path;
      
      if (node.type === 'directory') {
        return (
          <div key={node.path}>
            <div 
              className="flex items-center justify-between group hover:bg-slate-800/50 cursor-pointer text-slate-300 text-xs py-1 px-2 select-none"
              style={{ paddingLeft: `${ level * 12 + 8 }px` }}
              onClick={() => {
                const next = new Set(expandedDirs);
                if (isExpanded) next.delete(node.path);
                else next.add(node.path);
                setExpandedDirs(next);
              }}
            >
              <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
                {isExpanded ? <FolderOpen className="w-4 h-4 shrink-0 text-blue-400" /> : <Folder className="w-4 h-4 shrink-0 text-blue-400" />}
                <span className="truncate">{node.name}</span>
              </div>
              <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleCreateFile(node.path); }}
                  className="p-1 hover:text-white hover:bg-slate-700 rounded text-slate-400"
                  title="New File"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleCreateDirectory(node.path); }}
                  className="p-1 hover:text-white hover:bg-slate-700 rounded text-slate-400"
                  title="New Folder"
                >
                  <Folder className="w-3 h-3" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(node.path); }}
                  className="p-1 hover:text-rose-400 hover:bg-slate-700 rounded text-slate-400"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            {isExpanded && node.children && (
              <div>{renderTree(node.children, level + 1)}</div>
            )}
          </div>
        );
      }

      return (
        <div 
          key={node.path}
          className={cn(
            "flex items-center justify-between group cursor-pointer text-xs py-1 px-2 select-none border-l-2",
            isSelected ? "bg-blue-500/10 border-blue-500 text-blue-200" : "hover:bg-slate-800/50 border-transparent text-slate-400 hover:text-slate-200"
          )}
          style={{ paddingLeft: `${ level * 12 + 20 }px` }}
          onClick={() => setSelectedFilePath(node.path)}
        >
          <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
            {getFileIcon(node.name)}
            <span className="truncate">{node.name}</span>
          </div>
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
             <button 
                onClick={(e) => { e.stopPropagation(); handleDelete(node.path); }}
                className="p-1 hover:text-rose-400 hover:bg-slate-700 rounded text-slate-400"
                title="Delete"
             >
                <Trash2 className="w-3 h-3" />
             </button>
          </div>
        </div>
      );
    });
  };

  const isDirty = fileContent !== originalContent;

  return (
    <div className="flex h-full w-full flex-1 bg-slate-950 overflow-hidden font-sans z-20">
      {/* File Explorer Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Workspace</h3>
          <div className="flex items-center gap-1 text-slate-400">
             <button onClick={() => fetchFiles()} className="p-1 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors" title="Refresh">
                <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
             </button>
             <button onClick={() => handleCreateFile('')} className="p-1 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors" title="New File in Root">
                <Plus className="w-3 h-3" />
             </button>
             <button onClick={() => handleCreateDirectory('')} className="p-1 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors" title="New Folder in Root">
                <Folder className="w-3 h-3" />
             </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
          {nodes.length === 0 && !isLoading ? (
             <div className="text-center p-4 text-xs text-slate-500 italic">Workspace is empty.</div>
          ) : (
             renderTree(nodes)
          )}
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
        {selectedFilePath ? (
          <>
            <div className="h-10 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                {getFileIcon(selectedFilePath)}
                <span className="font-mono">{selectedFilePath}</span>
                {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 ml-2" title="Unsaved changes"></span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors",
                    isDirty 
                      ? "bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_10px_rgba(37,99,235,0.2)]" 
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  )}
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-[#282c34]" onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    handleSave();
                }
            }}>
              <CodeMirror
                value={fileContent}
                height="100%"
                theme="dark"
                extensions={getLanguageExtension(selectedFilePath)}
                onChange={(val) => setFileContent(val)}
                className="text-sm font-mono h-full"
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  foldGutter: true,
                  dropCursor: true,
                  allowMultipleSelections: true,
                  indentOnInput: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                  rectangularSelection: true,
                  crosshairCursor: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  closeBracketsKeymap: true,
                  defaultKeymap: true,
                  searchKeymap: true,
                  historyKeymap: true,
                  foldKeymap: true,
                  completionKeymap: true,
                  lintKeymap: true
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
             <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center border border-slate-800 shadow-inner">
                   <FileCode className="w-8 h-8 text-blue-500/50" />
                </div>
                <p className="text-sm font-medium text-slate-400 font-mono tracking-widest uppercase">Select a file to edit</p>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
