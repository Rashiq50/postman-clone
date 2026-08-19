import { TaskForm } from './TaskForm'
import { TaskList } from './TaskList'

export function TasksPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Tasks</h1>
        <p className="text-sm text-slate-500">Postman clone — basic CRUD setup</p>
      </header>

      <TaskForm />
      <TaskList />
    </>
  )
}
