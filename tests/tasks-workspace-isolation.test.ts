import { describe, it } from "node:test";
import assert from "node:assert/strict";

type TaskRecord = {
  id: string;
  workspace_id?: string | null;
  client_id: string | null;
  title: string;
  notes: string | null;
  due_at: string | null;
  assigned_to: string | null;
  completed: boolean;
  created_by: string | null;
};

// Mock service simulating CRM task service with workspace isolation via client and creator memberships
class MockTaskService {
  private tasks: TaskRecord[] = [];
  private clients: Array<{ id: string; workspace_id: string }> = [];
  private workspaceMembers: Array<{ user_id: string; workspace_id: string }> = [];

  registerClient(id: string, workspaceId: string) {
    this.clients.push({ id, workspace_id: workspaceId });
  }

  registerMember(userId: string, workspaceId: string) {
    this.workspaceMembers.push({ user_id: userId, workspace_id: workspaceId });
  }

  createTask(params: {
    workspaceId: string;
    title: string;
    clientId?: string | null;
    assignedTo?: string | null;
    dueAt?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }): TaskRecord {
    if (!params.workspaceId) {
      throw new Error("Workspace is required to create a task");
    }
    if (!params.title.trim()) {
      throw new Error("Task title is required");
    }

    const newTask: TaskRecord = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      client_id: params.clientId && params.clientId !== "none" ? params.clientId : null,
      title: params.title.trim(),
      notes: params.notes?.trim() || null,
      due_at: params.dueAt && params.dueAt.trim() ? new Date(params.dueAt).toISOString() : null,
      assigned_to: params.assignedTo && params.assignedTo !== "unassigned" ? params.assignedTo : null,
      completed: false,
      created_by: params.createdBy ?? null,
    };

    this.tasks.push(newTask);
    return newTask;
  }

  listWorkspaceTasks(workspaceId: string, currentUserId?: string): TaskRecord[] {
    if (!workspaceId) return [];

    const workspaceClientIds = new Set(
      this.clients.filter((c) => c.workspace_id === workspaceId).map((c) => c.id)
    );
    const workspaceMemberIds = new Set(
      this.workspaceMembers.filter((m) => m.workspace_id === workspaceId).map((m) => m.user_id)
    );

    return this.tasks.filter((task) => {
      if (task.workspace_id) return task.workspace_id === workspaceId;
      if (task.client_id) return workspaceClientIds.has(task.client_id);
      if (task.created_by) {
        return workspaceMemberIds.has(task.created_by) || task.created_by === currentUserId;
      }
      if (task.assigned_to) return workspaceMemberIds.has(task.assigned_to);
      return false;
    });
  }

  getTabCounts(workspaceId: string, currentUserId?: string) {
    const tasks = this.listWorkspaceTasks(workspaceId, currentUserId);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const openCount = tasks.filter((t) => !t.completed).length;
    const dueTodayCount = tasks.filter(
      (t) => !t.completed && t.due_at && new Date(t.due_at).getTime() <= todayEnd.getTime()
    ).length;
    const upcomingCount = tasks.filter(
      (t) => !t.completed && (!t.due_at || new Date(t.due_at).getTime() > todayEnd.getTime())
    ).length;
    const completedCount = tasks.filter((t) => t.completed).length;

    return { openCount, dueTodayCount, upcomingCount, completedCount };
  }

  toggleTask(workspaceId: string, taskId: string, completed: boolean, currentUserId?: string): TaskRecord {
    const workspaceTasks = this.listWorkspaceTasks(workspaceId, currentUserId);
    const target = workspaceTasks.find((t) => t.id === taskId);
    if (!target) {
      throw new Error("Task not found in this workspace.");
    }
    target.completed = completed;
    return target;
  }

  deleteTask(workspaceId: string, taskId: string, currentUserId?: string): boolean {
    const workspaceTasks = this.listWorkspaceTasks(workspaceId, currentUserId);
    const target = workspaceTasks.find((t) => t.id === taskId);
    if (!target) {
      throw new Error("Task not found in this workspace.");
    }
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    return true;
  }
}

describe("Follow-up Tasks Workspace Isolation & Creation Tests", () => {
  const wsA = "ws-user-a-111";
  const wsB = "ws-user-b-222";
  const userA = "user-a";
  const userB = "user-b";

  it("Test 1: Tasks created with optional due date save successfully", () => {
    const service = new MockTaskService();
    service.registerMember(userA, wsA);

    // Create task with no due date (optional)
    const taskWithoutDueDate = service.createTask({
      workspaceId: wsA,
      title: "Call Client whenever possible",
      dueAt: "", // empty due date
      createdBy: userA,
    });
    assert.equal(taskWithoutDueDate.due_at, null, "Due date must be optional and saved as null when empty");
    assert.equal(taskWithoutDueDate.title, "Call Client whenever possible");

    // Create task with valid due date
    const taskWithDueDate = service.createTask({
      workspaceId: wsA,
      title: "Urgent Meeting",
      dueAt: "2026-10-30",
      createdBy: userA,
    });
    assert.ok(taskWithDueDate.due_at !== null, "Due date must be parsed and stored when provided");
  });

  it("Test 2: Validation rejects empty title and missing workspace", () => {
    const service = new MockTaskService();
    assert.throws(
      () => service.createTask({ workspaceId: "", title: "Valid Title" }),
      /Workspace is required/,
      "Must throw error when workspace is missing"
    );
    assert.throws(
      () => service.createTask({ workspaceId: wsA, title: "   " }),
      /Task title is required/,
      "Must throw error when task title is empty"
    );
  });

  it("Test 3: Workspace isolation between Workspace A and Workspace B", () => {
    const service = new MockTaskService();
    service.registerMember(userA, wsA);
    service.registerMember(userB, wsB);
    service.registerClient("client-a-1", wsA);
    service.registerClient("client-b-1", wsB);

    // User A creates 1 general task and 1 client task in Workspace A
    const taskA1 = service.createTask({
      workspaceId: wsA,
      title: "General Task for A",
      createdBy: userA,
    });
    const taskA2 = service.createTask({
      workspaceId: wsA,
      title: "Client Task for A",
      clientId: "client-a-1",
      createdBy: userA,
    });

    // User B creates 1 task in Workspace B
    const taskB1 = service.createTask({
      workspaceId: wsB,
      title: "Private Task for B",
      clientId: "client-b-1",
      createdBy: userB,
    });

    const tasksInA = service.listWorkspaceTasks(wsA, userA);
    assert.equal(tasksInA.length, 2);
    assert.ok(tasksInA.some((t) => t.id === taskA1.id));
    assert.ok(tasksInA.some((t) => t.id === taskA2.id));
    assert.ok(!tasksInA.some((t) => t.id === taskB1.id), "Workspace A must NOT see Workspace B task");

    const tasksInB = service.listWorkspaceTasks(wsB, userB);
    assert.equal(tasksInB.length, 1);
    assert.equal(tasksInB[0]?.id, taskB1.id);
    assert.ok(!tasksInB.some((t) => t.id === taskA1.id), "Workspace B must NOT see Workspace A task");
  });

  it("Test 4: Tab counts are strictly scoped to active workspace", () => {
    const service = new MockTaskService();
    service.registerMember(userA, wsA);
    service.registerMember(userB, wsB);

    const taskA = service.createTask({ workspaceId: wsA, title: "Task A", createdBy: userA });
    service.toggleTask(wsA, taskA.id, true, userA);

    service.createTask({ workspaceId: wsB, title: "Task B1", createdBy: userB });
    service.createTask({ workspaceId: wsB, title: "Task B2", createdBy: userB });

    const countsA = service.getTabCounts(wsA, userA);
    assert.equal(countsA.completedCount, 1);
    assert.equal(countsA.openCount, 0);

    const countsB = service.getTabCounts(wsB, userB);
    assert.equal(countsB.completedCount, 0);
    assert.equal(countsB.openCount, 2);
  });

  it("Test 5: Cross-workspace toggle and deletion are prevented", () => {
    const service = new MockTaskService();
    service.registerMember(userA, wsA);
    service.registerMember(userB, wsB);

    const taskB = service.createTask({
      workspaceId: wsB,
      title: "Confidential B Task",
      createdBy: userB,
    });

    // Attempt to toggle taskB from Workspace A
    assert.throws(
      () => service.toggleTask(wsA, taskB.id, true, userA),
      /Task not found in this workspace/,
      "User in Workspace A cannot toggle Workspace B task"
    );

    // Attempt to delete taskB from Workspace A
    assert.throws(
      () => service.deleteTask(wsA, taskB.id, userA),
      /Task not found in this workspace/,
      "User in Workspace A cannot delete Workspace B task"
    );

    // Verify taskB is still in Workspace B and incomplete
    const freshTasksB = service.listWorkspaceTasks(wsB, userB);
    assert.equal(freshTasksB.length, 1);
    assert.equal(freshTasksB[0]?.completed, false);
  });
});
