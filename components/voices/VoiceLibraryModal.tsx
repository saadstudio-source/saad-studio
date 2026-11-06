"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X, Search, Play, Pause, Heart, Plus, Sparkles, Volume2,
  Mic, Globe, Users, Check, Flame, BookOpen, MessageSquare,
  Radio, Smartphone, Moon, ShieldCheck, RefreshCw, Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VOICE_CATALOG, VoiceDefinition } from "@/lib/voice-catalog";

interface VoiceLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVoice?: (voice: VoiceDefinition) => void;
  selectedVoiceId?: string;
}

export function VoiceLibraryModal({
  isOpen,
  onClose,
  onSelectVoice,
  selectedVoiceId,
}: VoiceLibraryModalProps) {
  const [voices, setVoices] = useState<VoiceDefinition[]>(VOICE_CATALOG);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("All languages");
  const [selectedGender, setSelectedGender] = useState<string>("All genders");
  const [activeTab, setActiveTab] = useState<"all" | "my_voices" | "favorites">("all");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [myVoices, setMyVoices] = useState<VoiceDefinition[]>([]);

  // Audio Playback state
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clone Voice Modal
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneGender, setCloneGender] = useState<"male" | "female">("male");
  const [cloneLanguage, setCloneLanguage] = useState("Arabic");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  // Load favorites and cloned voices from localStorage
  useEffect(() => {
    try {
      const savedFavs = localStorage.getItem("saad_studio_fav_voices");
      if (savedFavs) setFavorites(JSON.parse(savedFavs));

      const savedMyVoices = localStorage.getItem("saad_studio_custom_voices");
      if (savedMyVoices) setMyVoices(JSON.parse(savedMyVoices));
    } catch {}
  }, []);

  // Fetch updated catalog from API
  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
        setPlayingVoiceId(null);
      }
      return;
    }

    const fetchVoices = async () => {
      try {
        const res = await fetch("/api/voices");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.voices)) {
            setVoices(data.voices);
          }
        }
      } catch (err) {
        console.error("Failed to load voices:", err);
      }
    };
    fetchVoices();
  }, [isOpen]);

  const toggleFavorite = (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(voiceId) ? prev.filter((id) => id !== voiceId) : [...prev, voiceId];
      try {
        localStorage.setItem("saad_studio_fav_voices", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handlePlayPreview = (e: React.MouseEvent, voice: VoiceDefinition) => {
    e.stopPropagation();

    if (!voice.sampleUrl) return;

    if (playingVoiceId === voice.id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(voice.sampleUrl);
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => {
      setPlayingVoiceId(null);
      console.warn("Could not play audio sample for voice:", voice.name);
    };

    audio.play().catch(() => setPlayingVoiceId(null));
    audioRef.current = audio;
    setPlayingVoiceId(voice.id);
  };

  const handleSelect = (voice: VoiceDefinition) => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingVoiceId(null);
    }
    if (onSelectVoice) {
      onSelectVoice(voice);
    }
    onClose();
  };

  const handleCreateClone = (e: React.FormEvent) => {
    e.preventDefault();
    setIsCloning(false);
    window.alert("WaveSpeedAI documents Voice ID usage, but no official voice-cloning endpoint is available in the approved integration.");
  };

  // Filtered Voices list
  const filteredVoices = useMemo(() => {
    let list = activeTab === "my_voices" ? myVoices : [...myVoices, ...voices];

    if (activeTab === "favorites") {
      list = list.filter((v) => favorites.includes(v.id));
    }

    if (selectedCategory !== "all") {
      list = list.filter(
        (v) => v.category === selectedCategory || (selectedCategory === "arabic" && v.language === "Arabic")
      );
    }

    if (selectedLanguage !== "All languages") {
      list = list.filter((v) => v.language.toLowerCase() === selectedLanguage.toLowerCase());
    }

    if (selectedGender !== "All genders") {
      list = list.filter((v) => v.gender.toLowerCase() === selectedGender.toLowerCase());
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.accent.toLowerCase().includes(q) ||
          v.language.toLowerCase().includes(q) ||
          v.tag.toLowerCase().includes(q)
      );
    }

    return list;
  }, [voices, myVoices, activeTab, favorites, selectedCategory, selectedLanguage, selectedGender, searchQuery]);

  if (!isOpen || typeof document === "undefined") return null;

  // Portalled to the body: an ancestor with a transform — the Reference
  // Studio panel slides on one — turns `fixed` into `absolute` against itself,
  // which pinned this modal inside the panel and cut its header, and with it
  // the close button, out of view.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 md:p-8 overflow-y-auto">
      <div className="w-full max-w-5xl bg-[#111317] border border-zinc-800/90 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-6 text-zinc-100 relative max-h-[92vh] flex flex-col">
        {/* ─── Header ─── */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Voices</h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400 font-medium">
              {filteredVoices.length} available
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Language filter */}
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-750 text-zinc-300 text-xs font-medium focus:outline-none focus:border-zinc-500 cursor-pointer"
            >
              <option value="All languages">All languages</option>
              <option value="English">English</option>
              <option value="Arabic">Arabic (العربية)</option>
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Japanese">Japanese</option>
            </select>

            {/* Gender filter */}
            <select
              value={selectedGender}
              onChange={(e) => setSelectedGender(e.target.value)}
              className="px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-750 text-zinc-300 text-xs font-medium focus:outline-none focus:border-zinc-500 cursor-pointer"
            >
              <option value="All genders">All genders</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>

            {/* Favorites filter shortcut */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === "favorites" ? "all" : "favorites")}
              className={cn(
                "p-2 rounded-full border transition-colors",
                activeTab === "favorites"
                  ? "bg-rose-950/80 border-rose-500 text-rose-400"
                  : "bg-zinc-900/90 border-zinc-800 text-zinc-400 hover:text-white"
              )}
              title="Show Favorites"
            >
              <Heart className={cn("w-4 h-4", activeTab === "favorites" && "fill-rose-500")} />
            </button>

            {/* + Clone voice button */}
            <button
              type="button"
              onClick={() => setShowCloneModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#f5cb68] hover:bg-[#eabf55] text-zinc-950 font-bold text-xs shadow-md transition-transform hover:scale-[1.02]"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>Clone voice</span>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── Search Bar ─── */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name, accent..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 rounded-2xl bg-[#0c0d10] border border-zinc-800 text-zinc-200 placeholder-zinc-500 text-xs focus:outline-none focus:border-zinc-600 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ─── Category Chips ─── */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          {[
            { id: "all", label: "All voices", icon: "⚡" },
            { id: "narration", label: "Narration", icon: "📖" },
            { id: "characters", label: "Characters", icon: "🎭" },
            { id: "conversational", label: "Conversational", icon: "💬" },
            { id: "news", label: "News", icon: "🗞️" },
            { id: "epic", label: "Epic", icon: "🔥" },
            { id: "social", label: "Social", icon: "📱" },
            { id: "calm", label: "Calm", icon: "🧘" },
            { id: "arabic", label: "Arabic", icon: "🌙" },
          ].map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full font-medium transition-all text-xs",
                  isActive
                    ? "bg-[#f5cb68] text-zinc-950 font-bold shadow-md shadow-amber-500/10"
                    : "bg-[#181a20] border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                )}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* ─── Tabs ─── */}
        <div className="flex items-center gap-6 border-b border-zinc-800/80 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cn(
              "pb-2.5 transition-colors relative",
              activeTab === "all" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <span>All voices</span>
            {activeTab === "all" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f5cb68] rounded-full" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("my_voices")}
            className={cn(
              "pb-2.5 transition-colors relative flex items-center gap-1.5",
              activeTab === "my_voices" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <span>My voices</span>
            {myVoices.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-300">
                {myVoices.length}
              </span>
            )}
            {activeTab === "my_voices" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f5cb68] rounded-full" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("favorites")}
            className={cn(
              "pb-2.5 transition-colors relative flex items-center gap-1.5",
              activeTab === "favorites" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <span>Favorites</span>
            {favorites.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-300">
                {favorites.length}
              </span>
            )}
            {activeTab === "favorites" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f5cb68] rounded-full" />}
          </button>
        </div>

        {/* ─── Voice Cards Grid ─── */}
        <div className="flex-1 overflow-y-auto pr-1">
          {filteredVoices.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <Volume2 className="w-10 h-10 text-zinc-600 mx-auto" />
              <p className="text-zinc-400 text-sm font-medium">No voices found matching your criteria</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                  setSelectedLanguage("All languages");
                  setSelectedGender("All genders");
                  setActiveTab("all");
                }}
                className="text-xs text-[#f5cb68] hover:underline font-bold"
              >
                Reset all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredVoices.map((voice) => {
                const isPlaying = playingVoiceId === voice.id;
                const isSelected = selectedVoiceId === voice.id;
                const isFav = favorites.includes(voice.id);

                return (
                  <div
                    key={voice.id}
                    onClick={() => handleSelect(voice)}
                    className={cn(
                      "group p-3.5 rounded-2xl bg-[#16181e]/90 border transition-all cursor-pointer flex items-center justify-between gap-3 select-none",
                      isSelected
                        ? "border-[#f5cb68] bg-[#1a1b22] shadow-[0_0_15px_rgba(245,203,104,0.15)]"
                        : "border-zinc-800/80 hover:border-zinc-700 hover:bg-[#1a1d24]"
                    )}
                  >
                    {/* Left: Avatar + Details */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full overflow-hidden border border-zinc-700/80 flex-shrink-0 bg-zinc-800">
                        <img
                          src={voice.avatar}
                          alt={voice.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80";
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-zinc-100 truncate group-hover:text-white">
                            {voice.name}
                          </span>
                          {voice.isCloned && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 font-mono font-bold">
                              CLONE
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400 truncate mt-0.5">{voice.accent}</p>
                      </div>
                    </div>

                    {/* Right: Badge + Play Button + Heart */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Tag Badge */}
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase font-mono",
                          voice.tagColor === "green" && "bg-emerald-950/90 text-emerald-400 border border-emerald-800/60",
                          voice.tagColor === "blue" && "bg-sky-950/90 text-sky-400 border border-sky-800/60",
                          voice.tagColor === "red" && "bg-rose-950/90 text-rose-400 border border-rose-800/60",
                          voice.tagColor === "purple" && "bg-purple-950/90 text-purple-400 border border-purple-800/60",
                          voice.tagColor === "amber" && "bg-amber-950/90 text-amber-400 border border-amber-800/60",
                          voice.tagColor === "teal" && "bg-teal-950/90 text-teal-400 border border-teal-800/60"
                        )}
                      >
                        {voice.tag}
                      </span>

                      {/* Play / Pause button */}
                      <button
                        type="button"
                        onClick={(e) => handlePlayPreview(e, voice)}
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110",
                          isPlaying
                            ? "bg-[#f5cb68] text-zinc-950 shadow-md shadow-amber-500/20"
                            : "bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200"
                        )}
                        title={isPlaying ? "Pause Preview" : "Play Preview"}
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>

                      {/* Favorite Heart */}
                      <button
                        type="button"
                        onClick={(e) => toggleFavorite(e, voice.id)}
                        className="text-zinc-500 hover:text-rose-400 p-1 transition-colors"
                      >
                        <Heart
                          className={cn("w-3.5 h-3.5", isFav && "text-rose-500 fill-rose-500")}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Clone Voice Modal ─── */}
        {showCloneModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4">
            <div className="w-full max-w-md bg-[#16181f] border border-zinc-700 rounded-3xl p-6 space-y-5 text-zinc-100 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Mic className="w-5 h-5 text-[#f5cb68]" />
                  <h3 className="text-lg font-bold">Instant Voice Cloning</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCloneModal(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateClone} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Voice Name / اسم الصوت</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. My Custom Voice"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-[#f5cb68]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Gender / الجنس</label>
                    <select
                      value={cloneGender}
                      onChange={(e) => setCloneGender(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100"
                    >
                      <option value="male">Male (ذكر)</option>
                      <option value="female">Female (أنثى)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Language / اللغة</label>
                    <select
                      value={cloneLanguage}
                      onChange={(e) => setCloneLanguage(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100"
                    >
                      <option value="Arabic">Arabic (العربية)</option>
                      <option value="English">English</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Audio Sample File (10-30s) / عينة صوتية
                  </label>
                  <label className="border-2 border-dashed border-zinc-800 hover:border-[#f5cb68]/60 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-zinc-950/60 transition-colors">
                    <Upload className="w-6 h-6 text-zinc-400" />
                    <span className="text-xs text-zinc-300">
                      {cloneFile ? cloneFile.name : "Click to upload WAV or MP3 sample"}
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) setCloneFile(e.target.files[0]);
                      }}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCloneModal(false)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCloning || !cloneName.trim()}
                    className="px-5 py-2 rounded-xl bg-[#f5cb68] hover:bg-[#eabf55] text-zinc-950 font-bold text-xs shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isCloning ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Cloning Voice...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Clone & Save</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
