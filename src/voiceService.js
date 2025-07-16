/**
 * 语音服务模块
 * 提供语音识别(STT)和文字转语音(TTS)功能
 */

class VoiceService {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.synthesis = window.speechSynthesis;
        this.voices = [];
        
        // 初始化语音合成
        this.initSpeechSynthesis();
        
        // 检查浏览器支持
        this.isSpeechRecognitionSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
        this.isSpeechSynthesisSupported = 'speechSynthesis' in window;
    }

    /**
     * 初始化语音合成
     */
    initSpeechSynthesis() {
        if (this.isSpeechSynthesisSupported) {
            // 加载语音列表
            const loadVoices = () => {
                this.voices = this.synthesis.getVoices();
            };
            
            // 初始加载
            loadVoices();
            
            // 当语音列表改变时重新加载（某些浏览器异步加载）
            if (this.synthesis.onvoiceschanged !== undefined) {
                this.synthesis.onvoiceschanged = loadVoices;
            }
        }
    }

    /**
     * 开始语音识别
     * @param {Function} onResult 识别结果回调
     * @param {Function} onError 错误回调
     * @param {Function} onEnd 结束回调
     */
    startSpeechRecognition(onResult, onError, onEnd) {
        if (!this.isSpeechRecognitionSupported) {
            onError && onError(new Error('浏览器不支持语音识别'));
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        // 配置参数
        this.recognition.continuous = false; // 单次识别
        this.recognition.interimResults = false; // 只返回最终结果
        this.recognition.lang = 'zh-CN'; // 中文识别

        this.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            onResult && onResult(transcript);
        };

        this.recognition.onerror = (event) => {
            onError && onError(new Error(event.error));
        };

        this.recognition.onend = () => {
            this.isListening = false;
            onEnd && onEnd();
        };

        this.recognition.start();
        this.isListening = true;
    }

    /**
     * 停止语音识别
     */
    stopSpeechRecognition() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        }
    }

    /**
     * 文字转语音
     * @param {string} text 要转换的文字
     * @param {Object} options 配置选项
     */
    speak(text, options = {}) {
        if (!this.isSpeechSynthesisSupported) {
            console.warn('浏览器不支持语音合成');
            return;
        }

        // 停止之前的语音
        this.synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        
        // 配置选项
        utterance.rate = options.rate || 1.0; // 语速
        utterance.pitch = options.pitch || 1.0; // 音调
        utterance.volume = options.volume || 1.0; // 音量
        utterance.lang = options.lang || 'zh-CN'; // 语言

        // 选择语音
        if (this.voices.length > 0) {
            const chineseVoices = this.voices.filter(voice => 
                voice.lang.startsWith('zh') || voice.lang.startsWith('zh-CN')
            );
            if (chineseVoices.length > 0) {
                utterance.voice = chineseVoices[0];
            }
        }

        // 事件回调
        if (options.onStart) utterance.onstart = options.onStart;
        if (options.onEnd) utterance.onend = options.onEnd;
        if (options.onError) utterance.onerror = options.onError;

        this.synthesis.speak(utterance);
    }

    /**
     * 停止语音播放
     */
    stopSpeaking() {
        if (this.isSpeechSynthesisSupported) {
            this.synthesis.cancel();
        }
    }

    /**
     * 获取支持的语言列表
     */
    getSupportedLanguages() {
        if (!this.isSpeechRecognitionSupported) return [];
        
        // 常见的语音识别支持语言
        return [
            { code: 'zh-CN', name: '中文（简体）' },
            { code: 'zh-TW', name: '中文（繁体）' },
            { code: 'en-US', name: '英语（美国）' },
            { code: 'en-GB', name: '英语（英国）' },
            { code: 'ja-JP', name: '日语' },
            { code: 'ko-KR', name: '韩语' }
        ];
    }

    /**
     * 检查麦克风权限
     */
    async checkMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            return false;
        }
    }
}

// 创建全局实例
export const voiceService = new VoiceService();