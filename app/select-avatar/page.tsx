"use client";

import Link from "next/link";
import Image from "next/image";
import { avatars } from "@/lib/avatars";

export default function SelectAvatarPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-emerald-50 via-white to-white">
      <div className="max-w-4xl w-full space-y-12">
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

        <div className="text-center pt-4">
          <Link
            href="/"
            className="inline-block px-5 py-2 text-slate-500 hover:text-slate-900 transition-colors duration-200 text-sm"
          >
            ← Back to Start
          </Link>
        </div>
      </div>
    </main>
  );
}

