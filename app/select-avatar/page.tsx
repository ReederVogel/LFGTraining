"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { avatars, type Avatar } from "@/lib/avatars";
import { PersonalityControls } from "@/lib/prompt-builder";

// Default controls for each avatar
const createDefaultControls = (avatar: Avatar): PersonalityControls => ({
  sadnessLevel: 3,
  copingStyle: 'none',
  copingIntensity: 3,
  accentType: 'midwestern',
  accentStrength: 5,
  language: 'english',
  characterName: avatar.name, // Keep for prompt builder, but not shown in UI
  relationshipType: avatar.relationshipType,
  character: avatar.defaultCharacter || '',
  backstory: avatar.defaultBackstory || '',
  conversationGoal: avatar.defaultGoal || '',
});

export default function SelectAvatarPage() {
  const router = useRouter();
  const [openModalAvatarId, setOpenModalAvatarId] = useState<string | null>(null);
  const [avatarSettings, setAvatarSettings] = useState<Record<string, PersonalityControls>>(() => {
    const settings: Record<string, PersonalityControls> = {};
    avatars.forEach(avatar => {
      settings[avatar.id] = createDefaultControls(avatar);
    });
    return settings;
  });
  
  const [generatingField, setGeneratingField] = useState<{ avatarId: string; field: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, Set<string>>>({});
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingSessionStart, setPendingSessionStart] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setOpenModalAvatarId(null);
      }
    };

    if (openModalAvatarId) {
      document.addEventListener('mousedown', handleClickOutside);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [openModalAvatarId]);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openModalAvatarId) {
        setOpenModalAvatarId(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [openModalAvatarId]);

  // Handle starting a session with configured settings
  const handleStartSession = (avatarId: string) => {
    const settings = avatarSettings[avatarId];
    const avatar = avatars.find(a => a.id === avatarId);
    
    if (!avatar) return;
    
    // Check if any persona fields were manually edited
    const hasEditedFields = editedFields[avatarId] && editedFields[avatarId].size > 0;
    
    if (avatar.supportsCustomPersona && hasEditedFields) {
      // Show confirmation dialog
      setPendingSessionStart(avatarId);
      setShowConfirmDialog(true);
      return;
    }
    
    // Save settings to localStorage for the session page to read
    if (avatar.supportsCustomPersona) {
      localStorage.setItem(`avatar_${avatarId}_settings`, JSON.stringify(settings));
    }
    
    // Navigate to session page
    router.push(`/session/${avatarId}`);
  };

  // Confirm and start session
  const confirmAndStartSession = () => {
    if (!pendingSessionStart) return;
    
    const settings = avatarSettings[pendingSessionStart];
    const avatar = avatars.find(a => a.id === pendingSessionStart);
    
    if (!avatar) return;
    
    // Save settings to localStorage for the session page to read
    if (avatar.supportsCustomPersona) {
      localStorage.setItem(`avatar_${pendingSessionStart}_settings`, JSON.stringify(settings));
    }
    
    // Clear edited fields tracking
    setEditedFields(prev => {
      const newEdited = { ...prev };
      delete newEdited[pendingSessionStart];
      return newEdited;
    });
    
    setShowConfirmDialog(false);
    setPendingSessionStart(null);
    
    // Navigate to session page
    router.push(`/session/${pendingSessionStart}`);
  };

  // Cancel session start
  const cancelSessionStart = () => {
    setShowConfirmDialog(false);
    setPendingSessionStart(null);
  };

  // Update settings for a specific avatar
  const updateSettings = (avatarId: string, updates: Partial<PersonalityControls>, isFormatted = false) => {
    setAvatarSettings(prev => ({
      ...prev,
      [avatarId]: { ...prev[avatarId], ...updates }
    }));
    
    // Track which field was manually edited (not from formatting)
    if (!isFormatted) {
      const fieldKey = Object.keys(updates)[0];
      if (fieldKey && ['character', 'backstory', 'conversationGoal'].includes(fieldKey)) {
        setEditedFields(prev => {
          const newEdited = { ...prev };
          if (!newEdited[avatarId]) {
            newEdited[avatarId] = new Set<string>();
          }
          newEdited[avatarId].add(fieldKey);
          return newEdited;
        });
      }
    }
  };

  // Reset to defaults
  const resetToDefaults = (avatarId: string) => {
    const avatar = avatars.find(a => a.id === avatarId);
    if (avatar) {
      setAvatarSettings(prev => ({
        ...prev,
        [avatarId]: createDefaultControls(avatar)
      }));
    }
  };

  // Generate persona field with AI
  const generatePersonaField = async (avatarId: string, field: 'character' | 'backstory' | 'conversationGoal') => {
    const currentValue = avatarSettings[avatarId][field] || '';
    if (!currentValue.trim()) {
      setError('Please enter some text first');
      return;
    }
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    setError(null);
    setGeneratingField({ avatarId, field });
    
    try {
      // Get other fields as context to maintain consistency
      const currentSettings = avatarSettings[avatarId];
      const context: { character?: string; backstory?: string; conversationGoal?: string } = {};
      
      if (field !== 'character' && currentSettings.character) {
        context.character = currentSettings.character;
      }
      if (field !== 'backstory' && currentSettings.backstory) {
        context.backstory = currentSettings.backstory;
      }
      if (field !== 'conversationGoal' && currentSettings.conversationGoal) {
        context.conversationGoal = currentSettings.conversationGoal;
      }
      
      const response = await fetch('/api/generate-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          field, 
          input: currentValue,
          context: Object.keys(context).length > 0 ? context : undefined // Only send if context exists
        }),
        signal: abortController.signal,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate');
      }
      
      const { formatted } = await response.json();
      
      if (!abortController.signal.aborted) {
        updateSettings(avatarId, { [field]: formatted }, true);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Generation cancelled by user');
      } else {
        console.error('Error generating persona:', err);
        setError(err.message);
      }
    } finally {
      if (!abortController.signal.aborted) {
        setGeneratingField(null);
        abortControllerRef.current = null;
      }
    }
  };

  // Format all fields intelligently - ensures consistency across character, backstory, and goals
  const formatAllFields = async (avatarId: string) => {
    const avatar = avatars.find(a => a.id === avatarId);
    if (!avatar) return;
    
    const currentSettings = avatarSettings[avatarId];
    
    // Don't allow if already generating
    if (generatingField) return;
    
    // Check if character field has content
    if (!currentSettings.character?.trim()) {
      setError('Please enter character description first');
      return;
    }
    
    try {
      setError(null);
      
      // Step 1: Format character first
      setGeneratingField({ avatarId, field: 'character' });
      
      const charResponse = await fetch('/api/generate-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          field: 'character', 
          input: currentSettings.character 
        }),
      });
      
      if (!charResponse.ok) throw new Error('Failed to format character');
      
      const { formatted: formattedCharacter } = await charResponse.json();
      
      // Update character (mark as formatted)
      updateSettings(avatarId, { character: formattedCharacter }, true);
      
      // Wait a bit for better UX
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 2: Generate backstory based on formatted character
      setGeneratingField({ avatarId, field: 'backstory' });
      
      const backstoryInput = currentSettings.backstory?.trim() || 'Create an appropriate backstory for this character.';
      
      const backstoryResponse = await fetch('/api/generate-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          field: 'backstory', 
          input: backstoryInput,
          context: { character: formattedCharacter }
        }),
      });
      
      if (!backstoryResponse.ok) throw new Error('Failed to format backstory');
      
      const { formatted: formattedBackstory } = await backstoryResponse.json();
      
      // Update backstory (mark as formatted)
      updateSettings(avatarId, { backstory: formattedBackstory }, true);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 3: Generate conversation goal based on character and backstory
      setGeneratingField({ avatarId, field: 'conversationGoal' });
      
      const goalInput = currentSettings.conversationGoal?.trim() || 'Create appropriate conversation goals.';
      
      const goalResponse = await fetch('/api/generate-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          field: 'conversationGoal', 
          input: goalInput,
          context: { character: formattedCharacter, backstory: formattedBackstory }
        }),
      });
      
      if (!goalResponse.ok) throw new Error('Failed to format conversation goal');
      
      const { formatted: formattedGoal } = await goalResponse.json();
      
      // Update conversation goal (mark as formatted)
      updateSettings(avatarId, { conversationGoal: formattedGoal }, true);
      
      // Clear the edited fields tracking since everything is now in sync
      setEditedFields(prev => {
        const newEdited = { ...prev };
        delete newEdited[avatarId];
        return newEdited;
      });
    } catch (err: any) {
      console.error('Error formatting all fields:', err);
      setError(err.message || 'Failed to format fields');
    } finally {
      setGeneratingField(null);
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setGeneratingField(null);
      setError(null);
    }
  };

  const openModal = (avatarId: string) => {
    setOpenModalAvatarId(avatarId);
    setError(null);
  };

  const closeModal = () => {
    setOpenModalAvatarId(null);
    setError(null);
    // Also close confirmation dialog if open
    if (showConfirmDialog) {
      setShowConfirmDialog(false);
      setPendingSessionStart(null);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-white p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 rounded-xl sm:rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm">
          <div>
            <h1 className="text-xs sm:text-sm font-medium text-slate-900">
              Select Training Avatar
            </h1>
          </div>
          <Link
            href="/"
            className="group flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out rounded-lg text-xs font-medium border border-slate-200 hover:border-emerald-200 touch-manipulation min-h-[44px] sm:min-h-0"
            style={{ touchAction: 'manipulation' }}
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

        <div className="max-w-4xl mx-auto space-y-8 sm:space-y-10 md:space-y-12">
          <div className="text-center space-y-3 sm:space-y-4 px-4">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-light text-slate-900 tracking-tight">
              Select & Customize Training Avatar
            </h1>
            <div className="w-12 sm:w-14 md:w-16 h-0.5 bg-slate-900 mx-auto"></div>
            <p className="text-sm sm:text-base text-slate-600 font-light max-w-2xl mx-auto">
              Choose an avatar and customize their persona for your training scenario
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 md:gap-6">
            {avatars.map((avatar) => {
              const settings = avatarSettings[avatar.id];
              const isModalOpen = openModalAvatarId === avatar.id;
              const isGenerating = generatingField?.avatarId === avatar.id;

              return (
                <div
                  key={avatar.id}
                  className="rounded-2xl overflow-hidden border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white shadow-sm hover:shadow-lg hover:shadow-slate-200/50 hover:border-slate-300/70 hover:-translate-y-1 active:translate-y-0 transition-all duration-300 ease-out group card-hover"
                >
                  {/* Image */}
                  {avatar.imageSrc && (
                    <div className="relative w-full h-48 sm:h-52 md:h-56 overflow-hidden bg-slate-50">
                      <Image
                        src={avatar.imageSrc}
                        alt={`${avatar.name} avatar`}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover object-center grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-500 ease-out"
                        quality={100}
                        priority
                        unoptimized
                      />
                    </div>
                  )}

                  {/* Card content */}
                  <div className="p-4 sm:p-5 space-y-3 sm:space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-0">
                        <h2 className="text-base sm:text-lg font-medium text-slate-900 truncate">
                          {avatar.name}
                        </h2>
                        <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                          {avatar.role}
                        </p>
                      </div>
                      
                      {/* Gear icon button for persona settings */}
                      {avatar.supportsCustomPersona && (
                        <button
                          onClick={() => openModal(avatar.id)}
                          className="flex-shrink-0 p-2.5 sm:p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg hover:rotate-90 active:rotate-0 transition-all duration-300 ease-out touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                          title="Customize Persona"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                        </button>
                      )}
                    </div>

                    <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                      {avatar.scenario}
                    </p>

                    {/* Start Session Button */}
                    <button
                      onClick={() => handleStartSession(avatar.id)}
                      className="block w-full text-center px-5 py-3 sm:py-3 min-h-[44px] flex items-center justify-center bg-emerald-600 text-white text-sm sm:text-base font-medium rounded-lg hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out btn-primary touch-manipulation"
                      style={{ touchAction: 'manipulation' }}
                    >
                      Start Session
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Persona Settings Modal */}
      {openModalAvatarId && (() => {
        const avatar = avatars.find(a => a.id === openModalAvatarId);
        if (!avatar || !avatar.supportsCustomPersona) return null;
        const settings = avatarSettings[openModalAvatarId];
        const isGenerating = generatingField?.avatarId === openModalAvatarId;

        return (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closeModal();
              }
            }}
          >
            <div
              ref={modalRef}
              className="bg-white rounded-none sm:rounded-2xl shadow-2xl max-w-3xl w-full h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col modal-content"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-200 flex-shrink-0">
                <div className="min-w-0 flex-1 pr-2">
                  <h2 className="text-lg sm:text-xl font-semibold text-slate-900 truncate">Customize Persona</h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1 truncate">{avatar.role}</p>
                </div>
                <button
                  onClick={closeModal}
                  className="flex-shrink-0 p-2.5 sm:p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg hover:rotate-90 active:rotate-0 transition-all duration-300 ease-out touch-manipulation"
                  style={{ touchAction: 'manipulation' }}
                  title="Close"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content - Scrollable */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
                {/* Important Note */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 sm:p-3">
                  <div className="flex items-start gap-2 sm:gap-2">
                    <svg
                      className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-amber-800 leading-relaxed">
                        <strong>Customize for {avatar.role} scenario:</strong> Ensure the character description, backstory, and conversation goal match this relationship type. 
                        {avatar.relationshipType === 'widow' && ' Character should be a woman who lost her husband.'}
                        {avatar.relationshipType === 'son' && ' Character should be a son who lost his parent.'}
                        {avatar.relationshipType === 'daughter' && ' Character should be a daughter who lost her parent.'}
                        {avatar.relationshipType === 'father' && ' Character should be a father who lost his child or spouse.'}
                        {avatar.relationshipType === 'mother' && ' Character should be a mother who lost her child or spouse.'}
                        {avatar.relationshipType === 'sister' && ' Character should be a sister who lost her sibling.'}
                        {avatar.relationshipType === 'brother' && ' Character should be a brother who lost his sibling.'}
                        {avatar.relationshipType === 'friend' && ' Character should be a friend who lost someone close.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Character Description */}
                <div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-2 mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Character Description
                    </label>
                    <div className="flex gap-2 w-full sm:w-auto">
                      {isGenerating && generatingField?.field === 'character' ? (
                        <button
                          onClick={stopGeneration}
                          className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => generatePersonaField(openModalAvatarId, 'character')}
                          disabled={isGenerating}
                          className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none font-medium touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                        >
                          ✨ Format
                        </button>
                      )}
                      <button
                        onClick={() => updateSettings(openModalAvatarId, { character: avatar.defaultCharacter })}
                        className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                        style={{ touchAction: 'manipulation' }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <textarea
                      value={settings.character || ''}
                      onChange={(e) => updateSettings(openModalAvatarId, { character: e.target.value })}
                      rows={6}
                      disabled={isGenerating}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none font-mono leading-relaxed transition-all duration-200 ease-out ${
                        isGenerating && generatingField?.field === 'character'
                          ? 'border-emerald-300 bg-emerald-50/30 animate-pulse'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                      } ${isGenerating ? 'opacity-60 cursor-not-allowed' : ''}`}
                      placeholder="Describe the character in third person..."
                    />
                    {isGenerating && generatingField?.field === 'character' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-50/50 rounded-lg backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                          <span className="text-xs font-medium text-emerald-700">Formatting...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Backstory */}
                <div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-2 mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Backstory
                    </label>
                    <div className="flex gap-2 w-full sm:w-auto">
                      {isGenerating && generatingField?.field === 'backstory' ? (
                        <button
                          onClick={stopGeneration}
                          className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => generatePersonaField(openModalAvatarId, 'backstory')}
                          disabled={isGenerating}
                          className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none font-medium touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                        >
                          ✨ Format
                        </button>
                      )}
                      <button
                        onClick={() => updateSettings(openModalAvatarId, { backstory: avatar.defaultBackstory })}
                        className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                        style={{ touchAction: 'manipulation' }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <textarea
                      value={settings.backstory || ''}
                      onChange={(e) => updateSettings(openModalAvatarId, { backstory: e.target.value })}
                      rows={6}
                      disabled={isGenerating}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none font-mono leading-relaxed transition-all duration-200 ease-out ${
                        isGenerating && generatingField?.field === 'backstory'
                          ? 'border-emerald-300 bg-emerald-50/30 animate-pulse'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                      } ${isGenerating ? 'opacity-60 cursor-not-allowed' : ''}`}
                      placeholder="Describe the situation and context..."
                    />
                    {isGenerating && generatingField?.field === 'backstory' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-50/50 rounded-lg backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                          <span className="text-xs font-medium text-emerald-700">Formatting...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Conversation Goal */}
                <div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-2 mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Conversation Goal
                    </label>
                    <div className="flex gap-2 w-full sm:w-auto">
                      {isGenerating && generatingField?.field === 'conversationGoal' ? (
                        <button
                          onClick={stopGeneration}
                          className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => generatePersonaField(openModalAvatarId, 'conversationGoal')}
                          disabled={isGenerating}
                          className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none font-medium touch-manipulation"
                          style={{ touchAction: 'manipulation' }}
                        >
                          ✨ Format
                        </button>
                      )}
                      <button
                        onClick={() => updateSettings(openModalAvatarId, { conversationGoal: avatar.defaultGoal })}
                        className="flex-1 sm:flex-none text-xs px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                        style={{ touchAction: 'manipulation' }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <textarea
                      value={settings.conversationGoal || ''}
                      onChange={(e) => updateSettings(openModalAvatarId, { conversationGoal: e.target.value })}
                      rows={6}
                      disabled={isGenerating}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none font-mono leading-relaxed transition-all duration-200 ease-out ${
                        isGenerating && generatingField?.field === 'conversationGoal'
                          ? 'border-emerald-300 bg-emerald-50/30 animate-pulse'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                      } ${isGenerating ? 'opacity-60 cursor-not-allowed' : ''}`}
                      placeholder="What does the character want to achieve..."
                    />
                    {isGenerating && generatingField?.field === 'conversationGoal' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-50/50 rounded-lg backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                          <span className="text-xs font-medium text-emerald-700">Formatting...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                    {error}
                  </div>
                )}

                {/* Reset All Button */}
                <div className="pt-4 border-t border-slate-200">
                  <button
                    onClick={() => resetToDefaults(openModalAvatarId)}
                    className="w-full px-4 py-3 sm:py-2.5 min-h-[44px] sm:min-h-0 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out font-medium touch-manipulation"
                    style={{ touchAction: 'manipulation' }}
                  >
                    Reset All to Defaults
                  </button>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-slate-200 bg-slate-50 flex-shrink-0">
                <button
                  onClick={closeModal}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out touch-manipulation"
                  style={{ touchAction: 'manipulation' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    closeModal();
                    handleStartSession(openModalAvatarId);
                  }}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out touch-manipulation"
                  style={{ touchAction: 'manipulation' }}
                >
                  Save & Start Session
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirmation Dialog for Edited Fields */}
      {showConfirmDialog && pendingSessionStart && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              cancelSessionStart();
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-4 sm:p-6 space-y-4">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                Confirm Fields Are Correct
              </h3>
              <p className="text-sm text-slate-600">
                You've edited persona fields. Please make sure all fields are correctly edited and match each other. Some fields might not be compatible with others.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
              <button
                onClick={cancelSessionStart}
                className="flex-1 px-4 py-3 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out touch-manipulation"
                style={{ touchAction: 'manipulation' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmAndStartSession}
                className="flex-1 px-4 py-3 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 ease-out touch-manipulation"
                style={{ touchAction: 'manipulation' }}
              >
                Yes, Start Session
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
