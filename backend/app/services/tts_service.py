"""
Text-to-Speech service supporting multiple engines:
  1. gTTS   – Google TTS (requires internet, produces mp3)       [default]
  2. edge_tts – Microsoft Edge TTS (requires internet, high quality)
  3. pyttsx3 – Offline TTS (no internet needed, lower quality)

The engine is selected by TTS_ENGINE env var or falls back by availability.
Generated files are cached in backend/audio_storage/tts_cache/ by message hash.
"""
import hashlib
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

AUDIO_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "audio_storage")
TTS_CACHE_DIR = os.path.join(AUDIO_STORAGE_DIR, "tts_cache")
os.makedirs(TTS_CACHE_DIR, exist_ok=True)


def _cache_path(text: str, engine: str, lang: str = "en") -> str:
    key = hashlib.md5(f"{engine}:{lang}:{text}".encode()).hexdigest()
    ext = "mp3" if engine in ("gtts", "edge_tts") else "wav"
    return os.path.join(TTS_CACHE_DIR, f"{key}.{ext}")


def _try_gtts(text: str, lang: str, out_path: str) -> bool:
    try:
        from gtts import gTTS  # type: ignore
        tts = gTTS(text=text, lang=lang, slow=False)
        tts.save(out_path)
        return True
    except ImportError:
        logger.debug("gTTS not installed")
        return False
    except Exception as e:
        logger.warning("gTTS failed: %s", e)
        return False


def _try_edge_tts(text: str, lang: str, out_path: str) -> bool:
    """Microsoft Edge TTS – free, high quality, async under the hood."""
    try:
        import asyncio
        import edge_tts  # type: ignore

        voice_map = {
            "en": "en-US-JennyNeural",
            "ne": "ne-NP-HemkalaNeural",   # Nepali
            "hi": "hi-IN-SwaraNeural",
        }
        voice = voice_map.get(lang, "en-US-JennyNeural")

        async def _gen():
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(out_path)

        asyncio.run(_gen())
        return True
    except ImportError:
        logger.debug("edge-tts not installed")
        return False
    except Exception as e:
        logger.warning("edge-tts failed: %s", e)
        return False


def _try_pyttsx3(text: str, out_path: str) -> bool:
    """Offline TTS using pyttsx3 – no internet required."""
    try:
        import pyttsx3  # type: ignore
        engine = pyttsx3.init()
        engine.save_to_file(text, out_path)
        engine.runAndWait()
        return os.path.exists(out_path) and os.path.getsize(out_path) > 0
    except ImportError:
        logger.debug("pyttsx3 not installed")
        return False
    except Exception as e:
        logger.warning("pyttsx3 failed: %s", e)
        return False


def text_to_speech(text: str, lang: str = "en") -> Optional[str]:
    """
    Convert text to an audio file using the best available TTS engine.
    Returns the absolute path to the audio file, or None on failure.

    Engine priority:
      TTS_ENGINE env var → edge_tts → gtts → pyttsx3
    """
    preferred = os.environ.get("TTS_ENGINE", "").lower()

    engines = []
    if preferred == "edge_tts":
        engines = ["edge_tts", "gtts", "pyttsx3"]
    elif preferred == "pyttsx3":
        engines = ["pyttsx3", "gtts", "edge_tts"]
    elif preferred == "gtts":
        engines = ["gtts", "edge_tts", "pyttsx3"]
    else:
        # Auto: prefer edge_tts (best quality) then gtts then offline
        engines = ["edge_tts", "gtts", "pyttsx3"]

    for engine in engines:
        out_path = _cache_path(text, engine, lang)
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            logger.info("TTS cache hit [%s]: %s", engine, out_path)
            return out_path

        logger.info("TTS generating with engine=%s …", engine)
        ok = False
        if engine == "gtts":
            ok = _try_gtts(text, lang, out_path)
        elif engine == "edge_tts":
            ok = _try_edge_tts(text, lang, out_path)
        elif engine == "pyttsx3":
            ok = _try_pyttsx3(text, out_path)

        if ok and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            logger.info("TTS generated [%s] → %s", engine, out_path)
            return out_path

    logger.error("All TTS engines failed for text: %r", text[:80])
    return None


def asterisk_sound_path(abs_path: str) -> str:
    """
    Convert an absolute OS path to an Asterisk-compatible sound path.
    Asterisk's Playback() expects a path relative to /var/lib/asterisk/sounds/
    (without extension). We pass the full path and strip extension.
    Most modern Asterisk versions accept absolute paths in Playback().
    """
    # Strip common audio extensions; Asterisk auto-detects format
    base, _ = os.path.splitext(abs_path)
    return base
