import React, { useState, useEffect, useMemo } from 'react';
import { Briefcase, Plus, Trash2, Calendar, User, CheckCircle2, Circle, ArrowRight, Columns, BarChart, Clock, MoreVertical, Edit2, X, List, Search, Filter, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'REVIEW';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: string;
  deadline?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  tasks: Task[];
}

export function ProjectManager({ liveLogs = [] }: { liveLogs?: any[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [boardVersion, setBoardVersion] = useState<string | null>(null);
  
  // View States
  const [viewStyle, setViewStyle] = useState<'board' | 'list'>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'ALL'>('ALL');

  // Modals / Forms
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  
  // Form States
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  
  const [taskFormTitle, setTaskFormTitle] = useState('');
  const [taskFormDesc, setTaskFormDesc] = useState('');
  const [taskFormAssignee, setTaskFormAssignee] = useState('');
  const [taskFormDeadline, setTaskFormDeadline] = useState('');
  const [taskFormPriority, setTaskFormPriority] = useState<TaskPriority>('MEDIUM');

  // Setup: Load data from Workspace API
  const fetchProjects = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        setBoardVersion(data.version || null);
      }
    } catch (err) {
      console.error('Failed to load projects', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    
    // Periodically poll for background changes made by the AI Agent
    const interval = setInterval(() => {
        fetchProjects(true);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const saveProjects = async (updatedProjects: Project[]) => {
    setProjects(updatedProjects);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: updatedProjects,
          version: boardVersion
        })
      });
      if (res.status === 409) {
        alert('Project board changed in another session. Refreshing before applying your edit.');
        await fetchProjects(true);
        return;
      }
      if (!res.ok) throw new Error(`Failed to save projects: ${res.status}`);
      const saved = await res.json();
      setProjects(saved.projects || updatedProjects);
      setBoardVersion(saved.version || null);
    } catch (err) {
      console.error('Failed to save projects', err);
      await fetchProjects(true);
    }
  };

  const openNewProjectModal = () => {
    setEditingProject(null);
    setNewProjectName('');
    setNewProjectDesc('');
    setShowNewProjectModal(true);
  };

  const openEditProjectModal = (project: Project, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingProject(project);
    setNewProjectName(project.name);
    setNewProjectDesc(project.description);
    setShowNewProjectModal(true);
  };

  const saveProject = () => {
    if (!newProjectName.trim()) return;
    
    if (editingProject) {
      const updated = projects.map(p => 
        p.id === editingProject.id 
          ? { ...p, name: newProjectName.trim(), description: newProjectDesc.trim() } 
          : p
      );
      saveProjects(updated);
    } else {
      const newProject: Project = {
        id: crypto.randomUUID(),
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
        createdAt: Date.now(),
        tasks: []
      };
      saveProjects([...projects, newProject]);
    }
    
    setNewProjectName('');
    setNewProjectDesc('');
    setEditingProject(null);
    setShowNewProjectModal(false);
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    const updated = projects.filter(p => p.id !== id);
    saveProjects(updated);
    if (activeProjectId === id) setActiveProjectId(null);
  };

  const openNewTaskModal = () => {
    setEditingTask(null);
    setTaskFormTitle('');
    setTaskFormDesc('');
    setTaskFormAssignee('');
    setTaskFormDeadline('');
    setTaskFormPriority('MEDIUM');
    setShowNewTaskModal(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    setTaskFormTitle(task.title);
    setTaskFormDesc(task.description);
    setTaskFormAssignee(task.assignee || '');
    setTaskFormDeadline(task.deadline || '');
    setTaskFormPriority(task.priority || 'MEDIUM');
    setShowNewTaskModal(true);
  };

  const saveTask = () => {
    if (!taskFormTitle.trim() || !activeProjectId) return;
    const updatedProjects: Project[] = projects.map(p => {
      if (p.id === activeProjectId) {
        if (editingTask) {
          // Update existing task
          return {
            ...p,
            tasks: p.tasks.map(t => t.id === editingTask.id ? ({
              ...t,
              title: taskFormTitle.trim(),
              description: taskFormDesc.trim(),
              assignee: taskFormAssignee.trim(),
              deadline: taskFormDeadline,
              priority: taskFormPriority
            } as Task) : t)
          };
        } else {
          // Create new task
          return {
            ...p,
            tasks: [...p.tasks, {
              id: crypto.randomUUID(),
              title: taskFormTitle.trim(),
              description: taskFormDesc.trim(),
              status: 'TODO',
              priority: taskFormPriority,
              assignee: taskFormAssignee.trim(),
              deadline: taskFormDeadline
            } as Task]
          };
        }
      }
      return p;
    });
    saveProjects(updatedProjects);
    setShowNewTaskModal(false);
    setEditingTask(null);
  };

  const updateTaskStatus = (projectId: string, taskId: string, newStatus: TaskStatus) => {
    const updatedProjects: Project[] = projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          tasks: p.tasks.map(t => t.id === taskId ? ({ ...t, status: newStatus } as Task) : t)
        };
      }
      return p;
    });
    saveProjects(updatedProjects);
  };

  const deleteTask = (projectId: string, taskId: string) => {
    const updatedProjects = projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          tasks: p.tasks.filter(t => t.id !== taskId)
        };
      }
      return p;
    });
    saveProjects(updatedProjects);
  };

  const activeProject = projects.find(p => p.id === activeProjectId);

  const delegateTaskToSwarm = (project: Project, task: Task) => {
    const prompt = `Please handle this task from project "${project.name}":\n\nTask: ${task.title}\nDescription: ${task.description || ''}\n\nPriority: ${task.priority || 'MEDIUM'}\nAssignee: ${task.assignee || 'None'}\nDeadline: ${task.deadline || 'None'}\n\nEvaluate what needs to be done, take action, and update the status in projects.json when complete.`;
    window.dispatchEvent(new CustomEvent('delegate-to-swarm', { detail: { prompt } }));
  };

  const filteredTasks = useMemo(() => {
    if (!activeProject) return [];
    return activeProject.tasks.filter(t => {
      if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.assignee && t.assignee.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [activeProject, priorityFilter, searchQuery]);

  // DnD Handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId && activeProjectId) {
      updateTaskStatus(activeProjectId, taskId, status);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 flex items-center justify-center border-t-2 border-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex bg-slate-950 font-sans h-full w-full relative z-20 flex-col">
      {/* Top Header */}
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-10 bg-slate-950">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-indigo-500" />
            <h1 className="font-semibold text-lg text-slate-100 flex items-center gap-2">
               Project Management
               {activeProject && (
                 <>
                   <span className="text-slate-600">/</span>
                   <span className="text-indigo-400">{activeProject.name}</span>
                 </>
               )}
            </h1>
          </div>
          <div className="flex items-center gap-3">
             {activeProject ? (
                <div className="flex items-center gap-2">
                   <button 
                     onClick={(e) => openEditProjectModal(activeProject, e)}
                     className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded text-sm hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                   >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Project
                   </button>
                   <button 
                     onClick={() => setActiveProjectId(null)}
                     className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded text-sm hover:bg-slate-800 transition-colors"
                   >
                     Back to Dashboard
                   </button>
                </div>
             ) : (
                <button 
                  onClick={openNewProjectModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" /> New Project
                </button>
             )}
          </div>
      </header>

      <div className="flex-1 overflow-auto custom-scrollbar p-6">
         {!activeProject ? (
            // ================== DASHBOARD VIEW ==================
            <div className="max-w-6xl mx-auto">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {projects.length === 0 ? (
                   <div className="col-span-full py-16 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/50">
                     <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4">
                       <Briefcase className="w-8 h-8 text-indigo-500" />
                     </div>
                     <h3 className="text-xl font-bold text-slate-200 mb-2">No Projects Yet</h3>
                     <p className="text-slate-500 mb-6 text-center max-w-sm">Create your first project to start organizing tasks, tracking progress, and collaborating.</p>
                     <button onClick={openNewProjectModal} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">Create First Project</button>
                   </div>
                 ) : (
                   projects.map(project => {
                     const total = project.tasks.length;
                     const done = project.tasks.filter(t => t.status === 'DONE').length;
                     const progress = total > 0 ? Math.round((done / total) * 100) : 0;
                     
                     return (
                       <motion.div 
                         initial={{ opacity: 0, y: 10 }}
                         animate={{ opacity: 1, y: 0 }}
                         key={project.id}
                         onClick={() => setActiveProjectId(project.id)}
                         className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-indigo-500/50 hover:shadow-[0_0_20px_rgba(99,102,241,0.1)] transition-all cursor-pointer group flex flex-col"
                       >
                         <div className="flex justify-between items-start mb-2">
                           <h3 className="font-semibold text-lg text-slate-100 group-hover:text-indigo-400 transition-colors truncate pr-4">{project.name}</h3>
                           <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button onClick={(e) => openEditProjectModal(project, e)} className="p-1.5 text-slate-600 hover:text-indigo-400 bg-slate-950 rounded">
                               <Edit2 className="w-4 h-4" />
                             </button>
                             <button onClick={(e) => deleteProject(project.id, e)} className="p-1.5 text-slate-600 hover:text-rose-400 bg-slate-950 rounded">
                               <Trash2 className="w-4 h-4" />
                             </button>
                           </div>
                         </div>
                         <p className="text-sm text-slate-500 line-clamp-2 mb-6 flex-1 min-h-[40px]">{project.description || 'No description provided.'}</p>
                         
                         <div className="space-y-3">
                           <div className="flex items-center justify-between text-xs text-slate-400 font-medium uppercase tracking-wider">
                              <span className="flex items-center gap-1.5"><Columns className="w-3.5 h-3.5" /> {total} Tasks</span>
                              <span>{progress}%</span>
                           </div>
                           <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                              <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                           </div>
                           <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-2 pt-3 border-t border-slate-800/50">
                              <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                           </div>
                         </div>
                       </motion.div>
                     );
                   })
                 )}
               </div>
            </div>
         ) : (
            // ================== KANBAN / LIST VIEW ==================
            <div className="h-full flex flex-col max-w-full">
               <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 shrink-0 gap-4">
                  <div className="max-w-2xl">
                     <h2 className="text-2xl font-bold text-slate-100 mb-1">{activeProject.name}</h2>
                     <p className="text-slate-400 text-sm">{activeProject.description}</p>
                  </div>
                  <div className="flex items-center gap-3 w-full md:w-auto">
                    {/* View Toggle */}
                    <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
                      <button 
                        onClick={() => setViewStyle('board')}
                        className={cn("p-1.5 rounded transition-colors", viewStyle === 'board' ? "bg-slate-800 text-blue-400" : "text-slate-500 hover:text-slate-300")}
                        title="Board View"
                      >
                        <Columns className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setViewStyle('list')}
                        className={cn("p-1.5 rounded transition-colors", viewStyle === 'list' ? "bg-slate-800 text-blue-400" : "text-slate-500 hover:text-slate-300")}
                        title="List View"
                      >
                        <List className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Search & Filters */}
                    <div className="flex items-center gap-2 flex-1 md:flex-none">
                      <div className="relative flex-1 md:w-48">
                        <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-2" />
                        <input 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search tasks..."
                          className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 outline-none focus:border-blue-500"
                        />
                      </div>
                      <select 
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value as any)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-300 outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="ALL">All Priorities</option>
                        <option value="HIGH">High</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="LOW">Low</option>
                      </select>
                    </div>

                    <button 
                      onClick={openNewTaskModal}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20 whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" /> Add Task
                    </button>
                  </div>
               </div>

               {viewStyle === 'board' ? (
               <div className="flex-1 flex gap-6 overflow-x-auto custom-scrollbar pb-4">
                  {(['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE'] as TaskStatus[]).map((colStatus) => {
                     const colTasks = filteredTasks.filter(t => t.status === colStatus);
                     let title = "To Do";
                     let icon = <Circle className="w-4 h-4 text-slate-500" />;
                     let headerColor = "text-slate-400 border-slate-800 bg-slate-900/50";
                     if (colStatus === 'IN_PROGRESS') {
                        title = "In Progress";
                        icon = <Clock className="w-4 h-4 text-amber-500" />;
                        headerColor = "text-amber-400 border-amber-500/20 bg-amber-500/5";
                     } else if (colStatus === 'REVIEW') {
                        title = "Code Review";
                        icon = <Search className="w-4 h-4 text-indigo-500" />;
                        headerColor = "text-indigo-400 border-indigo-500/20 bg-indigo-500/5";
                     } else if (colStatus === 'BLOCKED') {
                        title = "Blocked";
                        icon = <X className="w-4 h-4 text-rose-500" />;
                        headerColor = "text-rose-400 border-rose-500/20 bg-rose-500/5";
                     } else if (colStatus === 'DONE') {
                        title = "Done";
                        icon = <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
                        headerColor = "text-emerald-400 border-emerald-500/20 bg-emerald-500/5";
                     }

                     return (
                       <div 
                         key={colStatus} 
                         className="flex flex-col w-[320px] shrink-0 bg-slate-900/30 rounded-xl border border-slate-800/60 overflow-hidden"
                         onDragOver={handleDragOver}
                         onDrop={(e) => handleDrop(e, colStatus)}
                       >
                          <div className={cn("p-3 border-b flex items-center justify-between", headerColor)}>
                             <div className="flex items-center gap-2 font-semibold text-sm tracking-wide">
                                {icon}
                                {title}
                             </div>
                             <span className="text-xs bg-slate-950 text-slate-400 px-2 py-0.5 rounded-full border border-slate-800">{colTasks.length}</span>
                          </div>
                          
                          <div className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-3">
                             {colTasks.length === 0 ? (
                                <div className="text-xs text-center py-8 text-slate-600 border border-dashed border-slate-800 rounded-lg">
                                  Drop tasks here
                                </div>
                             ) : (
                                colTasks.map(task => (
                                  <div 
                                    key={task.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, task.id)}
                                    className="bg-slate-900 p-4 rounded-lg border border-slate-700 hover:border-blue-500 hover:shadow-[0_4px_20px_rgba(59,130,246,0.1)] transition-all cursor-grab active:cursor-grabbing group relative"
                                  >
                                     <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button onClick={() => delegateTaskToSwarm(activeProject, task)} className="p-1 text-slate-500 hover:text-indigo-400 rounded hover:bg-slate-800" title="Delegate to AI Swarm">
                                          <Bot className="w-3.5 h-3.5" />
                                       </button>
                                       <button onClick={() => openEditTaskModal(task)} className="p-1 text-slate-500 hover:text-blue-400 rounded hover:bg-slate-800" title="Edit Task">
                                          <Edit2 className="w-3.5 h-3.5" />
                                       </button>
                                       <button onClick={() => deleteTask(activeProject.id, task.id)} className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800" title="Delete Task">
                                          <X className="w-3.5 h-3.5" />
                                       </button>
                                     </div>
                                     
                                     <div className="flex items-center gap-2 mb-1.5">
                                        <span className={cn(
                                          "px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider",
                                          !task.priority || task.priority === 'MEDIUM' ? 'bg-slate-800 text-slate-400' :
                                          task.priority === 'HIGH' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        )}>
                                           {task.priority || 'MEDIUM'}
                                        </span>
                                     </div>
                                     
                                     <h4 className="text-sm font-semibold text-slate-200 pr-10 mb-1.5 leading-snug">{task.title}</h4>
                                     {task.description && <p className="text-xs text-slate-400 line-clamp-2 mb-3">{task.description}</p>}
                                     
                                     <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-slate-800/60">
                                        {task.assignee && (
                                           <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-300">
                                              <User className="w-3.5 h-3.5 text-blue-400" /> {task.assignee}
                                           </div>
                                        )}
                                        {task.deadline && (
                                           <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                                              <Calendar className="w-3.5 h-3.5 text-rose-400" /> {task.deadline}
                                           </div>
                                        )}
                                     </div>
                                  </div>
                                ))
                             )}
                          </div>
                       </div>
                     );
                  })}
               </div>
               ) : (
               <div className="flex-1 overflow-auto custom-scrollbar pb-4">
                 <div className="bg-slate-900/30 rounded-xl border border-slate-800/60 overflow-hidden">
                   <table className="w-full text-left text-sm text-slate-300">
                     <thead className="bg-slate-900 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                       <tr>
                         <th className="px-4 py-3">Task</th>
                         <th className="px-4 py-3">Status</th>
                         <th className="px-4 py-3">Priority</th>
                         <th className="px-4 py-3">Assignee</th>
                         <th className="px-4 py-3">Deadline</th>
                         <th className="px-4 py-3 w-20 text-right">Actions</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-800/60">
                       {filteredTasks.length === 0 ? (
                         <tr>
                           <td colSpan={6} className="px-4 py-8 text-center text-slate-500 italic">No tasks match your criteria.</td>
                         </tr>
                       ) : (
                         filteredTasks.map(task => (
                           <tr key={task.id} className="hover:bg-slate-800/20 group">
                             <td className="px-4 py-3">
                               <div className="font-semibold text-slate-200">{task.title}</div>
                               {task.description && <div className="text-xs text-slate-500 truncate max-w-xs">{task.description}</div>}
                             </td>
                             <td className="px-4 py-3">
                               <select 
                                 value={task.status} 
                                 onChange={(e) => updateTaskStatus(activeProject.id, task.id, e.target.value as TaskStatus)}
                                 className="bg-transparent border border-slate-800 hover:border-slate-600 rounded px-2 py-1 text-xs cursor-pointer outline-none focus:border-blue-500"
                               >
                                 <option value="TODO">To Do</option>
                                 <option value="IN_PROGRESS">In Progress</option>
                                 <option value="DONE">Done</option>
                               </select>
                             </td>
                             <td className="px-4 py-3">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider",
                                  !task.priority || task.priority === 'MEDIUM' ? 'bg-slate-800 text-slate-400' :
                                  task.priority === 'HIGH' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                )}>
                                   {task.priority || 'MEDIUM'}
                                </span>
                             </td>
                             <td className="px-4 py-3">
                                {task.assignee ? (
                                  <div className="flex items-center gap-1.5 text-xs text-slate-300">
                                     <User className="w-3.5 h-3.5 text-blue-400" /> {task.assignee}
                                  </div>
                                ) : <span className="text-slate-600">-</span>}
                             </td>
                             <td className="px-4 py-3 text-mono text-xs text-slate-400">
                                {task.deadline || <span className="text-slate-600">-</span>}
                             </td>
                             <td className="px-4 py-3 text-right">
                               <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button onClick={() => delegateTaskToSwarm(activeProject, task)} className="p-1.5 text-slate-400 hover:text-indigo-400 rounded hover:bg-slate-800" title="Delegate to AI Swarm">
                                    <Bot className="w-3.5 h-3.5" />
                                 </button>
                                 <button onClick={() => openEditTaskModal(task)} className="p-1.5 text-slate-400 hover:text-blue-400 rounded hover:bg-slate-800" title="Edit Task">
                                    <Edit2 className="w-3.5 h-3.5" />
                                 </button>
                                 <button onClick={() => deleteTask(activeProject.id, task.id)} className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800" title="Delete Task">
                                    <X className="w-3.5 h-3.5" />
                                 </button>
                               </div>
                             </td>
                           </tr>
                         ))
                       )}
                     </tbody>
                   </table>
                 </div>
               </div>
               )}
            </div>
         )}
      </div>

      {/* NEW PROJECT MODAL */}
      <AnimatePresence>
         {showNewProjectModal && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6">
                 <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2"><Briefcase className="w-5 h-5 text-indigo-400" /> {editingProject ? 'Edit Project' : 'Create New Project'}</h3>
                 <div className="space-y-4">
                    <div>
                       <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Project Name</label>
                       <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-600" placeholder="e.g., Q3 Marketing Campaign" />
                    </div>
                    <div>
                       <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Description (Optional)</label>
                       <textarea value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)} className="w-full h-24 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none placeholder:text-slate-600" placeholder="A brief description of the project goals..." />
                    </div>
                 </div>
                 <div className="flex gap-3 justify-end mt-6">
                    <button onClick={() => setShowNewProjectModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
                    <button onClick={saveProject} disabled={!newProjectName.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-900/20">{editingProject ? 'Save Changes' : 'Create Project'}</button>
                 </div>
              </motion.div>
           </div>
         )}
      </AnimatePresence>

      {/* NEW/EDIT TASK MODAL */}
      <AnimatePresence>
         {showNewTaskModal && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6">
                 <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                   <Columns className="w-5 h-5 text-blue-400" /> {editingTask ? 'Edit Task' : 'Add New Task'}
                 </h3>
                 <div className="space-y-4">
                    <div>
                       <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Task Title</label>
                       <input autoFocus value={taskFormTitle} onChange={e => setTaskFormTitle(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600" placeholder="e.g., Update Landing Page Copy" />
                    </div>
                    <div>
                       <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Description</label>
                       <textarea value={taskFormDesc} onChange={e => setTaskFormDesc(e.target.value)} className="w-full h-20 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none placeholder:text-slate-600" placeholder="Details about what needs to be done..." />
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                       <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Priority</label>
                          <select value={taskFormPriority} onChange={e => setTaskFormPriority(e.target.value as TaskPriority)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all appearance-none cursor-pointer">
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                            <option value="CRITICAL">Critical</option>
                          </select>
                       </div>
                       <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Assignee</label>
                          <div className="relative">
                             <User className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
                             <input value={taskFormAssignee} onChange={e => setTaskFormAssignee(e.target.value)} className="w-full pl-9 pr-3 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600" placeholder="Name or Role" />
                          </div>
                       </div>
                       <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Deadline</label>
                          <div className="relative">
                             <Calendar className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
                             <input type="date" value={taskFormDeadline} onChange={e => setTaskFormDeadline(e.target.value)} className="w-full pl-9 pr-3 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all [&::-webkit-calendar-picker-indicator]:invert" />
                          </div>
                       </div>
                    </div>
                 </div>
                 <div className="flex gap-3 justify-end mt-6">
                    <button onClick={() => setShowNewTaskModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
                    <button onClick={saveTask} disabled={!taskFormTitle.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-blue-900/20">{editingTask ? 'Save Changes' : 'Add Task'}</button>
                 </div>
              </motion.div>
           </div>
         )}
      </AnimatePresence>

      {/* SWARM ACTIVITY FEED SIDEBAR */}
      <div className="absolute top-14 right-0 bottom-0 w-80 border-l border-slate-800 bg-slate-950/50 backdrop-blur-md z-30 hidden xl:flex flex-col">
         <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
               <Bot className="w-4 h-4 text-indigo-400" /> Swarm Activity
            </h3>
            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 animate-pulse">Live</span>
         </div>
         <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {liveLogs.filter(log => log.payload?.action?.includes('TASK') || log.sourceAgentId === 'PROJECT_SERVICE').length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-600 text-center px-4">
                  <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center mb-3">
                     <Clock className="w-5 h-5" />
                  </div>
                  <p className="text-xs">No project-related agent activity detected yet.</p>
               </div>
            ) : (
               liveLogs.filter(log => log.payload?.action?.includes('TASK') || log.sourceAgentId === 'PROJECT_SERVICE').reverse().map((log: any, i: number) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={i} 
                    className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg text-xs"
                  >
                     <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-indigo-400">{log.sourceAgentId}</span>
                        <span className="text-[10px] text-slate-600 font-mono">{new Date().toLocaleTimeString()}</span>
                     </div>
                     <p className="text-slate-300 leading-relaxed italic">"{log.payload?.text || log.payload?.action}"</p>
                  </motion.div>
               ))
            )}
         </div>
      </div>
    </div>
  );
}
