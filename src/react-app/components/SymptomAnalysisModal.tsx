import { useState, useEffect, useRef } from "react";
import { X, Brain, AlertCircle, Upload, Image as ImageIcon, FileText, Trash2 } from "lucide-react";
import type { MedicalImageTypeEnum } from "@/shared/types";

interface SymptomAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ImageUpload {
  file: File;
  preview: string;
  type: MedicalImageTypeEnum;
  description: string;
}

export default function SymptomAnalysisModal({ isOpen, onClose, onSuccess }: SymptomAnalysisModalProps) {
  const [symptoms, setSymptoms] = useState("");
  const [images, setImages] = useState<ImageUpload[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastRequestTimeRef = useRef<number>(0);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount or close
  useEffect(() => {
    if (!isOpen) {
      // Cancel any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // Clear cooldown timer
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      setCooldownSeconds(0);
      setError("");
    }
  }, [isOpen]);

  // Cooldown timer effect
  useEffect(() => {
    if (cooldownSeconds > 0) {
      cooldownTimerRef.current = setInterval(() => {
        setCooldownSeconds((prev) => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) {
              clearInterval(cooldownTimerRef.current);
              cooldownTimerRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [cooldownSeconds]);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: ImageUpload[] = [];
    for (let i = 0; i < Math.min(files.length, 5 - images.length); i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const preview = URL.createObjectURL(file);
        newImages.push({
          file,
          preview,
          type: 'SYMPTOM_PHOTO',
          description: ''
        });
      }
    }
    setImages([...images, ...newImages]);
  };

  const removeImage = (index: number) => {
    const newImages = [...images];
    URL.revokeObjectURL(newImages[index].preview);
    newImages.splice(index, 1);
    setImages(newImages);
  };

  const updateImageType = (index: number, type: MedicalImageTypeEnum) => {
    const newImages = [...images];
    newImages[index].type = type;
    setImages(newImages);
  };

  const updateImageDescription = (index: number, description: string) => {
    const newImages = [...images];
    newImages[index].description = description;
    setImages(newImages);
  };

  const uploadImagesToCloudflare = async (): Promise<Array<{ url: string; type: MedicalImageTypeEnum; description?: string }>> => {
    const uploadedImages = [];
    
    for (const image of images) {
      const formData = new FormData();
      formData.append('file', image.file);

      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const data = await response.json();
      uploadedImages.push({
        url: data.url,
        type: image.type,
        description: image.description || undefined,
      });
    }

    return uploadedImages;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check cooldown
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTimeRef.current;
    const cooldownMs = 5000; // 5 seconds
    
    if (timeSinceLastRequest < cooldownMs && lastRequestTimeRef.current > 0) {
      const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastRequest) / 1000);
      setCooldownSeconds(remainingSeconds);
      setError(`Please wait ${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''} before submitting again.`);
      return;
    }

    // Validate input
    if (!symptoms.trim()) {
      setError("Please describe the symptoms before submitting.");
      return;
    }

    setIsSubmitting(true);
    setIsUploading(images.length > 0);
    setError("");

    // Create abort controller for request cancellation
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Upload images first if any
      let uploadedImages = [];
      if (images.length > 0) {
        uploadedImages = await uploadImagesToCloudflare();
      }

      const response = await fetch("/api/diagnostic-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          symptoms,
          images: uploadedImages.length > 0 ? uploadedImages : undefined
        }),
        signal, // Enable request cancellation
      });

      const data = await response.json();

      if (response.ok) {
        // Update last request time and set cooldown
        lastRequestTimeRef.current = Date.now();
        setCooldownSeconds(5);
        
        onSuccess();
        onClose();
        setSymptoms("");
        setImages([]);
        // Clean up image previews
        images.forEach(img => URL.revokeObjectURL(img.preview));
      } else {
        // Handle rate limit responses (429)
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("Retry-After");
          const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : data.retryAfterSeconds || 60;
          setCooldownSeconds(retryAfterSeconds);
          setError(data.message || `Rate limit reached. Please wait ${retryAfterSeconds}s and try again.`);
          return;
        }

        // Handle retryable errors
        if (data.retryable && data.error) {
          setError(`${data.error} The system will retry automatically.`);
        } else {
          setError(data.error || "Failed to request analysis. Please try again.");
        }
      }
    } catch (err: any) {
      // Handle abort errors (user closed modal)
      if (err.name === 'AbortError') {
        console.log("Request cancelled");
        return;
      }
      
      // Handle network errors
      if (err.message?.includes('fetch')) {
        setError("Network error. Please check your connection and try again.");
      } else {
        setError(err.message || "Failed to request analysis. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-700 p-6 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">AI Symptom Analysis</h2>
                <p className="text-purple-100 text-sm">Get preliminary insights reviewed by a doctor</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>

        {/* Important Notice */}
        <div className="p-6 bg-amber-50 border-b border-amber-200">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-1">Medical Disclaimer</h3>
              <p className="text-sm text-amber-800 leading-relaxed">
                Our AI provides preliminary analysis only. A licensed doctor will review your report before 
                it's released to you. This is not a substitute for professional medical advice. In emergencies, 
                call 10177 immediately.
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Describe Your Symptoms *
            </label>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              required
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              placeholder="Please describe your symptoms in detail. Include:
- What symptoms you're experiencing
- How long you've had them
- Severity (mild, moderate, severe)
- Any triggers or patterns you've noticed
- Current medications or conditions

Example: 'I've had a persistent headache for 3 days, mainly on the right side. It gets worse in bright light and I feel nauseous. I'm taking blood pressure medication.'"
            />
            <p className="text-xs text-gray-500 mt-2">
              The more detail you provide, the better our AI can analyze your symptoms.
            </p>
          </div>

          {/* Image Upload Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Medical Images (Optional)
            </label>
            <p className="text-xs text-gray-600 mb-3">
              Upload photos of visible symptoms, X-rays, scans, or other medical imagery (Max 5 images)
            </p>
            
            {/* Image Upload Button */}
            {images.length < 5 && (
              <label className="flex items-center justify-center w-full px-4 py-8 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-purple-500 hover:bg-purple-50 transition-colors">
                <div className="text-center">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Click to upload images</p>
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG, JPEG up to 10MB each</p>
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            )}

            {/* Uploaded Images Preview */}
            {images.length > 0 && (
              <div className="mt-4 space-y-4">
                {images.map((image, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex gap-4">
                      {/* Image Preview */}
                      <div className="flex-shrink-0">
                        <img 
                          src={image.preview} 
                          alt={`Upload ${index + 1}`}
                          className="w-24 h-24 object-cover rounded-lg"
                        />
                      </div>

                      {/* Image Details */}
                      <div className="flex-1 space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Image Type
                          </label>
                          <select
                            value={image.type}
                            onChange={(e) => updateImageType(index, e.target.value as MedicalImageTypeEnum)}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          >
                            <option value="SYMPTOM_PHOTO">Symptom Photo</option>
                            <option value="XRAY">X-Ray</option>
                            <option value="CT_SCAN">CT Scan</option>
                            <option value="MRI">MRI</option>
                            <option value="ULTRASOUND">Ultrasound</option>
                            <option value="ECG">ECG</option>
                            <option value="DERMATOLOGY_PHOTO">Skin Condition</option>
                            <option value="DENTAL_XRAY">Dental X-Ray</option>
                            <option value="DENTAL_PHOTO">Dental Photo</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Description (Optional)
                          </label>
                          <input
                            type="text"
                            value={image.description}
                            onChange={(e) => updateImageDescription(index, e.target.value)}
                            placeholder="E.g., Left arm rash, taken today"
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>
                      </div>

                      {/* Remove Button */}
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="flex-shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove image"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">What happens next?</h4>
            <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
              <li>Our AI analyzes your symptoms, images, and recent health data</li>
              <li>AI matches symptoms/images to relevant medical databases</li>
              <li>Your case is routed to the appropriate healthcare professional (GP, dermatologist, dentist, etc.)</li>
              <li>A licensed professional reviews the AI's findings and provides their diagnosis</li>
              <li>You can request escalation to a specialist if needed (subject to approval and cost)</li>
              <li>You'll be notified when your report is ready to view</li>
            </ol>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !symptoms.trim() || cooldownSeconds > 0}
              className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span>Uploading Images...</span>
                </>
              ) : isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span>Analyzing...</span>
                </>
              ) : cooldownSeconds > 0 ? (
                <>
                  <span>Please wait {cooldownSeconds}s</span>
                </>
              ) : (
                "Request Analysis"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
