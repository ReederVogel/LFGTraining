"use client";

import Link from "next/link";
import Image from "next/image";
import { avatars } from "@/lib/avatars";

export default function SelectAvatarPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-sm font-medium text-slate-900">
              Select Training Avatar
            </h1>
          </div>
          <Link
            href="/"
            className="group flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-all duration-200 rounded-lg text-xs font-medium border border-slate-200 hover:border-emerald-200"
            title="Go to Home"
          >
            <svg 
              className="w-4 h-4 transition-transform group-hover:scale-110" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              strokeWidth={2}
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" 
              />
            </svg>
            <span>Home</span>
          </Link>
        </div>

        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-light text-slate-900 tracking-tight">
              Select Training Avatar
            </h1>
            <div className="w-16 h-0.5 bg-slate-900 mx-auto"></div>
            <p className="text-slate-600 font-light">
              Choose an avatar to practice your conversation skills
            </p>
          </div>

        <div className="grid md:grid-cols-2 gap-6">
          {avatars.map((avatar) => (
            <div
              key={avatar.id}
              className="rounded-2xl overflow-hidden border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white shadow-sm hover:shadow-md hover:border-slate-300/70 transition-all duration-200 group"
            >
              {/* Image */}
              {avatar.imageSrc && (
                <div className="relative w-full h-72 overflow-hidden bg-slate-50">
                  <Image
                    src={avatar.imageSrc}
                    alt={`${avatar.name} avatar`}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover object-center grayscale group-hover:grayscale-0 transition-all duration-300"
                    quality={100}
                    priority
                    unoptimized
                  />
                </div>
              )}

              {/* Card content */}
              <div className="p-6 space-y-5">
                <div className="space-y-1">
                  <h2 className="text-lg font-medium text-slate-900">
                    {avatar.name}
                  </h2>
                  <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                    {avatar.role}
                  </p>
                </div>

                <p className="text-sm text-slate-600 leading-relaxed">
                  {avatar.scenario}
                </p>

                <Link
                  href={`/session/${avatar.id}`}
                  className="block w-full text-center px-5 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors duration-200 btn-primary"
                >
                  Start Session
                </Link>
              </div>
            </div>
          ))}
        </div>

        </div>
      </div>
    </main>
  );
}

