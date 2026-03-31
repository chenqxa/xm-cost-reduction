import { Project } from "@/types";
import { Folder, Trash2, ListTodo, ArrowRight } from "lucide-react";
import { Button } from "./ui/Button";

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
  taskCount: number;
}

export function ProjectCard({ project, onDelete, onView, taskCount }: ProjectCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl bg-[color:var(--xm-card)] p-6 shadow-[var(--xm-shadow-sm)] transition-all hover:shadow-[var(--xm-shadow)] border border-[color:var(--xm-border)]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--xm-card-soft)] text-[color:var(--xm-text)]">
            <Folder className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-[color:var(--xm-text)] text-lg">{project.name}</h3>
        </div>
        <button
          onClick={() => onDelete(project.id)}
          className="text-[color:var(--xm-muted)] hover:text-[color:var(--xm-danger)] transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-4 text-sm xm-muted line-clamp-2 h-10">
        {project.description}
      </p>

      <div className="mt-6">
        <div className="flex justify-between text-sm font-medium text-[color:var(--xm-text)] mb-2">
          <span>项目进度</span>
          <span>{project.progress}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--xm-card-soft)] border border-[color:var(--xm-border)]">
          <div
            className="h-full bg-[color:var(--xm-primary)] transition-all duration-500"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm xm-muted">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--xm-card-soft)] text-[color:var(--xm-text)]">
            <ListTodo className="h-4 w-4" />
          </div>
          <span>{taskCount} 个任务</span>
        </div>
        <Button
          variant="secondary"
          className="gap-1 text-xs h-8"
          onClick={() => onView(project.id)}
        >
          查看详情
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
