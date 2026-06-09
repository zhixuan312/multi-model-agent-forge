import { redirect } from 'next/navigation';

/** Root → the app landing surface. Auth gating happens in `(app)/layout`. */
export default function Home() {
  redirect('/projects');
}
