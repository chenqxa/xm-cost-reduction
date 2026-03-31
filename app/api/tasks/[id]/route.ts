import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { deleteTask, getProjectById, getTaskById, toggleTask } from "@/lib/server/store";
import { Project, User } from "@/types";

const canEditTask = (user: User, project: Project) => {
  if (user.role === "admin") return true;
  if (user.role === "manager") {
    return project.type === "company" || project.departmentId === user.departmentId;
  }
  const role = project.memberRoles?.[user.id];
  if (role) return role !== "viewer";
  return project.memberIds.includes(user.id);
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "任务ID不能为空" }, { status: 400 });
  }
  const task = getTaskById(id);
  if (!task) {
    return NextResponse.json({ message: "任务不存在" }, { status: 404 });
  }
  const project = getProjectById(task.projectId);
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }
  if (!canEditTask(user, project)) {
    return NextResponse.json({ message: "无权限操作任务" }, { status: 403 });
  }
  const updated = toggleTask(task.id);
  if (!updated) {
    return NextResponse.json({ message: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "任务ID不能为空" }, { status: 400 });
  }
  const task = getTaskById(id);
  if (!task) {
    return NextResponse.json({ message: "任务不存在" }, { status: 404 });
  }
  const project = getProjectById(task.projectId);
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }
  if (!canEditTask(user, project)) {
    return NextResponse.json({ message: "无权限操作任务" }, { status: 403 });
  }
  deleteTask(task.id);
  return NextResponse.json({ success: true });
}
