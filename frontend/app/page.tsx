import { redirect } from 'next/navigation'

// A raiz leva para a tela de trabalho do dia a dia.
export default function Home() {
  redirect('/vistorias')
}
