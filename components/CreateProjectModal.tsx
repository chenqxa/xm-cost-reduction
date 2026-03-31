import { useState } from "react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Textarea } from "./ui/Textarea";
import { Department, Project, User } from "@/types";

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    project: Pick<
      Project,
      | "name"
      | "description"
      | "initiator"
      | "problem"
      | "goal"
      | "actions"
      | "resources"
      | "cycle"
      | "benefit"
      | "approval"
      | "type"
      | "departmentId"
    >
  ) => void;
  currentUser: User;
  departments: Department[];
}

export function CreateProjectModal({
  open,
  onOpenChange,
  onSubmit,
  currentUser,
  departments,
}: CreateProjectModalProps) {
  const buildInitialFormData = () => {
    const defaultDepartmentId =
      currentUser.departmentId || departments[0]?.id || "";
    return {
      name: "",
      description: "",
      initiator: currentUser.name,
      problem: "",
      goal: "",
      actions: "",
      resources: "",
      cycle: "",
      benefit: "",
      approval: "",
      type: "department" as const,
      departmentId: defaultDepartmentId,
    };
  };

  const [formData, setFormData] = useState(buildInitialFormData);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = {
      ...formData,
      departmentId:
        formData.departmentId || currentUser.departmentId || departments[0]?.id || "",
    };
    onSubmit(normalized);
    onOpenChange(false);
    setFormData(buildInitialFormData());
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="新建项目">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">项目名称</Label>
          <Input id="name" name="name" required value={formData.name} onChange={handleChange} placeholder="如：A系列工矿灯结构简化VA/VE项目" />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="description">项目简介 (显示在卡片上)</Label>
          <Input
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="简短描述项目内容"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="departmentId">所属部门</Label>
            <select
              id="departmentId"
              name="departmentId"
              value={formData.departmentId}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, departmentId: e.target.value }))
              }
              className="h-10 w-full rounded-lg border border-[color:var(--xm-border)] bg-[color:var(--xm-surface)] px-3 text-sm text-[color:var(--xm-text)]"
              disabled={currentUser.role === "manager"}
            >
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="initiator">发起小组/人</Label>
            <Input id="initiator" name="initiator" value={formData.initiator} onChange={handleChange} placeholder="设计优化小组 / 张三" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cycle">项目周期</Label>
          <Input id="cycle" name="cycle" value={formData.cycle} onChange={handleChange} placeholder="起止日期 (通常不超过6个月)" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="problem">问题描述/机会点</Label>
          <Textarea id="problem" name="problem" value={formData.problem} onChange={handleChange} placeholder="当前成本过高、效率低下的具体表现（附数据）" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="goal">项目目标 (SMART)</Label>
          <Textarea id="goal" name="goal" value={formData.goal} onChange={handleChange} placeholder="量化目标：如“单台材料成本降低￥15...”" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="actions">主要行动措施</Label>
          <Textarea id="actions" name="actions" value={formData.actions} onChange={handleChange} placeholder="简要列出关键步骤（如：三维建模、仿真分析...）" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="resources">资源需求</Label>
          <Input id="resources" name="resources" value={formData.resources} onChange={handleChange} placeholder="预计投入工时、需要其他部门配合、预算" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="benefit">效益测算</Label>
          <Input id="benefit" name="benefit" value={formData.benefit} onChange={handleChange} placeholder="财务部协助计算的节约金额、投资回报率(ROI)" />
        </div>
        
         <div className="space-y-2">
          <Label htmlFor="approval">审批意见</Label>
          <Input id="approval" name="approval" value={formData.approval} onChange={handleChange} placeholder="降本办公室意见 / 战略委员会批准" />
        </div>

        <div className="flex justify-end pt-4">
          <Button type="submit">
            创建项目
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
