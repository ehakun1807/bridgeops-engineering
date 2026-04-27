import React, { useState, useRef } from 'react';
import { Upload, X, File } from 'lucide-react';

interface BOMAnalyzerToolProps {}

const BOMAnalyzerTool: React.FC<BOMAnalyzerToolProps> = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedFormats = ['.xlsx', '.xls', '.csv'];
  const acceptedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ];

  const validateFile = (file: File): boolean => {
    // Check file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = acceptedFormats.some((format) => fileName.endsWith(format));

    if (!hasValidExtension) {
      setError(`Invalid file type. Accepted formats: ${acceptedFormats.join(', ')}`);
      return false;
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size must be less than 10MB');
      return false;
    }

    setError(null);
    return true;
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2">
          Upload BOM File
        </h3>
        <p className="text-[12px] text-slate-500">
          Upload an XLSX, XLS, or CSV file containing your bill of materials
        </p>
      </div>

      {!selectedFile ? (
        <>
          {/* Drag and drop area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer ${
              dragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50'
            }`}
          >
            <Upload
              size={32}
              className={`mx-auto mb-3 ${dragActive ? 'text-blue-600' : 'text-slate-400'}`}
            />
            <p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-1">
              Drag and drop your file here
            </p>
            <p className="text-[12px] text-slate-500 mb-4">or click below to browse</p>

            <button
              onClick={handleClick}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors"
            >
              Select File
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedMimeTypes.join(',')}
              onChange={handleFileSelect}
              className="hidden"
              aria-label="Upload BOM file"
            />
          </div>

          {/* Supported formats info */}
          <div className="mt-4 p-3 bg-slate-100 rounded text-[11px] text-slate-600">
            <strong>Supported formats:</strong> {acceptedFormats.join(', ')} (max 10MB)
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-600">
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          {/* File selected state */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 p-2 bg-blue-100 rounded">
                  <File size={20} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={handleRemoveFile}
                className="flex-shrink-0 p-1 hover:bg-slate-200 rounded transition-colors ml-2"
                aria-label="Remove file"
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          {/* Placeholder for future Analyze button */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-[11px] text-slate-500 italic mb-4">
              Analysis feature coming soon. Your file is ready to upload and analyze.
            </p>
            {/* Future Analyze button would go here */}
            {/* <button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors"
            >
              Analyze BOM
            </button> */}
          </div>
        </>
      )}
    </div>
  );
};

export default BOMAnalyzerTool;
