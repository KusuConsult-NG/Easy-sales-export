"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Play,
    Pause,
    Volume2,
    VolumeX,
    Maximize,
    Minimize,
    SkipForward,
    SkipBack,
    Settings
} from "lucide-react";

interface VideoPlayerProps {
    courseId: string;
    videoUrl: string;
    initialProgress?: number;
    onProgressUpdate?: (progress: number, timeWatched: number) => Promise<void>;
    onComplete?: () => void;
}

export function VideoPlayer({
    courseId,
    videoUrl,
    initialProgress = 0,
    onProgressUpdate,
    onComplete
}: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [progress, setProgress] = useState(initialProgress);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [showControls, setShowControls] = useState(true);
    const [buffered, setBuffered] = useState(0);

    // Auto-hide controls after 3 seconds of inactivity
    useEffect(() => {
        if (!showControls) return;

        const timer = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 3000);

        return () => clearTimeout(timer);
    }, [showControls, isPlaying]);

    // Sync progress to backend every 10 seconds
    useEffect(() => {
        if (!isPlaying || !videoRef.current || !onProgressUpdate) return;

        const interval = setInterval(async () => {
            const video = videoRef.current;
            if (!video) return;

            const progressPercent = (video.currentTime / video.duration) * 100;
            setProgress(progressPercent);

            // Call Server Action
            await onProgressUpdate(progressPercent, video.currentTime);

            // Check if completed (>95%)
            if (progressPercent > 95 && onComplete) {
                onComplete();
            }
        }, 10000); // Every 10 seconds

        return () => clearInterval(interval);
    }, [isPlaying, onProgressUpdate, onComplete]);

    // Resume from last watched position
    useEffect(() => {
        if (videoRef.current && initialProgress > 0) {
            const video = videoRef.current;
            video.addEventListener('loadedmetadata', () => {
                const resumeTime = (video.duration * initialProgress) / 100;
                video.currentTime = resumeTime;
            });
        }
    }, [initialProgress]);

    // Update buffered progress
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const updateBuffer = () => {
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const bufferedPercent = (bufferedEnd / video.duration) * 100;
                setBuffered(bufferedPercent);
            }
        };

        video.addEventListener('progress', updateBuffer);
        return () => video.removeEventListener('progress', updateBuffer);
    }, []);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            videoRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            const prog = (videoRef.current.currentTime / videoRef.current.duration) * 100;
            setProgress(prog);
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!videoRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        videoRef.current.currentTime = pos * videoRef.current.duration;
    };

    const skip = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative bg-black rounded-lg overflow-hidden group"
            onMouseMove={() => setShowControls(true)}
            onMouseLeave={() => isPlaying && setShowControls(false)}
        >
            {/* Video Element */}
            <video
                ref={videoRef}
                src={videoUrl}
                className="w-full aspect-video cursor-pointer"
                onClick={togglePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
            />

            {/* Play/Pause Overlay */}
            <AnimatePresence>
                {!isPlaying && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/30"
                        onClick={togglePlay}
                    >
                        <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            className="w-20 h-20 rounded-full bg-[#1358ec] flex items-center justify-center shadow-2xl"
                        >
                            <Play className="w-10 h-10 text-white ml-1" />
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Custom Controls */}
            <AnimatePresence>
                {showControls && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-4"
                    >
                        {/* Progress Bar */}
                        <div
                            className="w-full h-2 bg-gray-600 rounded-full mb-4 cursor-pointer relative overflow-hidden"
                            onClick={handleSeek}
                        >
                            {/* Buffered Progress */}
                            <motion.div
                                className="absolute h-full bg-gray-500 rounded-full"
                                style={{ width: `${buffered}%` }}
                            />

                            {/* Watched Progress */}
                            <motion.div
                                className="absolute h-full bg-[#1358ec] rounded-full"
                                initial={{ width: `${progress}%` }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.1 }}
                            />

                            {/* Progress Indicator */}
                            <motion.div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg"
                                style={{ left: `${progress}%`, marginLeft: '-8px' }}
                                whileHover={{ scale: 1.5 }}
                            />
                        </div>

                        {/* Controls Row */}
                        <div className="flex items-center justify-between text-white">
                            {/* Left Controls */}
                            <div className="flex items-center space-x-4">
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={togglePlay}
                                    className="hover:text-[#1358ec] transition-colors"
                                >
                                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                                </motion.button>

                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => skip(-10)}
                                    className="hover:text-[#1358ec] transition-colors"
                                >
                                    <SkipBack className="w-5 h-5" />
                                </motion.button>

                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => skip(10)}
                                    className="hover:text-[#1358ec] transition-colors"
                                >
                                    <SkipForward className="w-5 h-5" />
                                </motion.button>

                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={toggleMute}
                                    className="hover:text-[#1358ec] transition-colors"
                                >
                                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                </motion.button>

                                <span className="text-sm font-medium">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </span>
                            </div>

                            {/* Right Controls */}
                            <div className="flex items-center space-x-4">
                                <motion.div className="flex items-center space-x-2">
                                    <span className="text-xs font-medium">{Math.round(progress)}%</span>
                                    <div className="w-24 h-1 bg-gray-600 rounded-full overflow-hidden">
                                        <motion.div
                                            className="h-full bg-green-500"
                                            initial={{ width: `${progress}%` }}
                                            animate={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </motion.div>

                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={toggleFullscreen}
                                    className="hover:text-[#1358ec] transition-colors"
                                >
                                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                                </motion.button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
