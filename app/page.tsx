import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-white">
      <div className="max-w-2xl w-full text-center space-y-12">
        <div className="space-y-6">
          <h1 className="text-5xl font-light text-slate-900 tracking-tight">
            LFGTraining Studio
          </h1>
          <div className="w-16 h-0.5 bg-slate-900 mx-auto"></div>
          <p className="text-lg text-slate-600 max-w-xl mx-auto leading-relaxed font-light">
            A realistic studio to practice compassionate conversations with grieving
            families in a safe, supportive training environment.
          </p>
        </div>

        <div className="pt-4">
          <Link
            href="/select-avatar"
            className="inline-block px-10 py-4 bg-emerald-600 text-white text-base font-medium rounded-lg hover:bg-emerald-700 transition-colors duration-200 btn-primary"
          >
            Start Training
          </Link>
        </div>
      </div>
    </main>
  );
}

