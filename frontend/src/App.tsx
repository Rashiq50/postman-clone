import { TaskForm } from './features/tasks/TaskForm'
import { TaskList } from './features/tasks/TaskList'

function App() {
  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <main className="mx-auto max-w-3xl px-4">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500">Postman clone — basic CRUD setup</p>
        </header>

        <TaskForm />
        <TaskList />
      </main>
    </div>
  )
}

export default App
