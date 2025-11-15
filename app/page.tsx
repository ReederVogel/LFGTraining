import Button from '@/components/ui/Button';
import { APP_NAME } from '@/lib/constants';
import Link from 'next/link';

// Prefetch the select-avatar page for faster navigation
export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <main className="w-full max-w-2xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-8">
          {APP_NAME}
        </h1>
        
        <p className="text-lg sm:text-xl text-gray-600 mb-16 leading-relaxed">
          Practice empathy and communication skills with AI-powered training
        </p>
        
        <Button 
          href="/select-avatar" 
          variant="primary"
          size="lg"
        >
          Start Training
        </Button>
        
        {/* Prefetch the next page for instant navigation */}
        <Link href="/select-avatar" prefetch={true} className="hidden" aria-hidden="true" />
      </main>
    </div>
  );
}
