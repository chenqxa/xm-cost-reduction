import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { addTask, getProjectById } from "@/lib/server/store";
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "项目ID不能为空" }, { status: 400 });
  }
  const project = getProjectById(id);
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }
  if (!canEditTask(user, project)) {
    return NextResponse.json({ message: "无权限操作任务" }, { status: 403 });
  }
  const body = (await request.json()) as { title?: string; assignee?: string };
  if (!body.title) {
    return NextResponse.json({ message: "任务标题不能为空" }, { status: 400 });
  }
  const task = addTask(project.id, body.title, body.assignee);
  return NextResponse.json(task);
}
