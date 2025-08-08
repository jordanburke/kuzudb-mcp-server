export interface WebUIConfig {
  databasePath: string
  isReadOnly: boolean
  version: string
}

export function getWebUIHTML(config: WebUIConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kuzu Database Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 1.1rem;
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        .card h2 {
            color: #333;
            margin-bottom: 20px;
            font-size: 1.5rem;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .info-label {
            font-weight: 600;
            color: #666;
        }
        
        .info-value {
            color: #333;
            font-family: 'Courier New', monospace;
        }
        
        .button-group {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
        }
        
        .btn-secondary {
            background: #f0f0f0;
            color: #333;
        }
        
        .btn-secondary:hover {
            background: #e0e0e0;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .upload-area {
            border: 2px dashed #ccc;
            border-radius: 8px;
            padding: 40px;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            margin-bottom: 20px;
        }
        
        .upload-area:hover {
            border-color: #667eea;
            background: #f8f9ff;
        }
        
        .upload-area.dragover {
            border-color: #667eea;
            background: #f0f2ff;
        }
        
        .upload-icon {
            font-size: 3rem;
            margin-bottom: 10px;
        }
        
        .file-input {
            display: none;
        }
        
        .progress {
            display: none;
            margin-top: 20px;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #f0f0f0;
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            width: 0%;
            transition: width 0.3s ease;
        }
        
        .progress-text {
            margin-top: 10px;
            text-align: center;
            color: #666;
        }
        
        .message {
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            display: none;
        }
        
        .message.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .message.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .message.info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        
        .readonly-badge {
            display: inline-block;
            background: #ffc107;
            color: #333;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🗄️ Kuzu Database Manager</h1>
            <p>Version ${config.version}</p>
        </div>
        
        <div class="card">
            <h2>Database Information</h2>
            <div class="info-grid">
                <span class="info-label">Database Path:</span>
                <span class="info-value">${config.databasePath}</span>
                
                <span class="info-label">Mode:</span>
                <span class="info-value">
                    ${config.isReadOnly ? '<span class="readonly-badge">Read-Only</span>' : "Read/Write"}
                </span>
                
                <span class="info-label">Status:</span>
                <span class="info-value" id="status">Connected</span>
            </div>
        </div>
        
        <div class="card">
            <h2>📥 Download Database</h2>
            <p style="margin-bottom: 20px; color: #666;">
                Download a backup of your Kuzu database files.
            </p>
            <div class="button-group">
                <button class="btn btn-primary" onclick="downloadBackup()">
                    <span>⬇️</span>
                    <span>Download Backup</span>
                </button>
                <button class="btn btn-secondary" onclick="downloadExport()">
                    <span>📤</span>
                    <span>Export (Kuzu Format)</span>
                </button>
            </div>
            <div class="progress" id="downloadProgress">
                <div class="progress-bar">
                    <div class="progress-fill" id="downloadProgressFill"></div>
                </div>
                <div class="progress-text" id="downloadProgressText">Preparing download...</div>
            </div>
        </div>
        
        ${
          !config.isReadOnly
            ? `
        <div class="card">
            <h2>📤 Upload & Restore</h2>
            <p style="margin-bottom: 20px; color: #666;">
                Upload a backup file to restore your database. This will replace the current database.
            </p>
            
            <div class="upload-area" id="uploadArea" onclick="document.getElementById('fileInput').click()">
                <div class="upload-icon">📁</div>
                <p>Click to browse or drag and drop your database files here</p>
                <p style="font-size: 0.9rem; color: #999; margin-top: 10px;">
                    Supports: .kuzu backups, or raw database files (select both main + .wal files)
                </p>
            </div>
            
            <input type="file" id="fileInput" class="file-input" multiple accept=".gz,.kuzu,.zip,.wal,.db,*" onchange="handleFileSelect(event)">
            
            <div style="margin-top: 20px; text-align: center;">
                <button class="btn btn-secondary" onclick="showSingleFileUpload()" style="padding: 10px 20px; background: #444; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    📤 Having issues? Try uploading files separately
                </button>
            </div>
            
            <!-- Single file upload section (hidden by default) -->
            <div id="singleFileUpload" style="display: none; margin-top: 20px; padding: 20px; border: 2px dashed #444; border-radius: 5px; background: #1a1a1a;">
                <h3 style="margin-top: 0;">Upload Files Separately</h3>
                <p>Upload your database files one at a time. This method is more reliable for large files.</p>
                
                <div style="margin: 15px 0;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold;">Step 1: Main Database File (required)</label>
                    <input type="file" id="mainFileInput" accept=".db,*" onchange="uploadSingleFile('main', this.files[0])" style="margin: 10px 0;">
                    <div id="mainFileStatus" style="margin-top: 5px; color: #888;"></div>
                </div>
                
                <div style="margin: 15px 0;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold;">Step 2: WAL File (optional)</label>
                    <input type="file" id="walFileInput" accept=".wal,*" onchange="uploadSingleFile('wal', this.files[0])" style="margin: 10px 0;">
                    <div id="walFileStatus" style="margin-top: 5px; color: #888;"></div>
                </div>
            </div>
            
            <div class="progress" id="uploadProgress">
                <div class="progress-bar">
                    <div class="progress-fill" id="uploadProgressFill"></div>
                </div>
                <div class="progress-text" id="uploadProgressText">Uploading...</div>
            </div>
        </div>
        `
            : ""
        }
        
        <div class="message" id="message"></div>
    </div>
    
    <script>
        // Drag and drop handling
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                handleFileSelect({ target: { files: e.dataTransfer.files } });
            });
        }
        
        function showMessage(text, type) {
            const messageEl = document.getElementById('message');
            messageEl.textContent = text;
            messageEl.className = 'message ' + type;
            messageEl.style.display = 'block';
            
            if (type !== 'error') {
                setTimeout(() => {
                    messageEl.style.display = 'none';
                }, 5000);
            }
        }
        
        function showProgress(progressId, text) {
            const progress = document.getElementById(progressId);
            const progressText = document.getElementById(progressId + 'Text');
            progress.style.display = 'block';
            progressText.textContent = text;
        }
        
        function updateProgress(progressId, percent) {
            const progressFill = document.getElementById(progressId + 'Fill');
            progressFill.style.width = percent + '%';
        }
        
        function hideProgress(progressId) {
            const progress = document.getElementById(progressId);
            progress.style.display = 'none';
        }
        
        async function downloadBackup() {
            try {
                showProgress('downloadProgress', 'Preparing backup...');
                updateProgress('downloadProgress', 30);
                
                const baseUrl = window.location.origin;
                const response = await fetch(baseUrl + '/api/backup');
                if (!response.ok) {
                    throw new Error('Failed to download backup');
                }
                
                updateProgress('downloadProgress', 70);
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'kuzu-backup-' + new Date().toISOString().slice(0, 10) + '.kuzu';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                updateProgress('downloadProgress', 100);
                showMessage('Backup downloaded successfully!', 'success');
                
                setTimeout(() => hideProgress('downloadProgress'), 1000);
            } catch (error) {
                hideProgress('downloadProgress');
                showMessage('Error downloading backup: ' + error.message, 'error');
            }
        }
        
        async function downloadExport() {
            try {
                showProgress('downloadProgress', 'Exporting database...');
                updateProgress('downloadProgress', 30);
                
                const response = await fetch('/api/export');
                if (!response.ok) {
                    throw new Error('Failed to export database');
                }
                
                updateProgress('downloadProgress', 70);
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'kuzu-export-' + new Date().toISOString().slice(0, 10) + '.zip';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                updateProgress('downloadProgress', 100);
                showMessage('Export downloaded successfully!', 'success');
                
                setTimeout(() => hideProgress('downloadProgress'), 1000);
            } catch (error) {
                hideProgress('downloadProgress');
                showMessage('Error exporting database: ' + error.message, 'error');
            }
        }
        
        function showSingleFileUpload() {
            document.getElementById('singleFileUpload').style.display = 'block';
            document.getElementById('uploadArea').style.display = 'none';
        }
        
        let uploadedFiles = { main: false, wal: false };
        
        async function uploadSingleFile(fileType, file) {
            if (!file) return;
            
            const statusElement = document.getElementById(fileType === 'main' ? 'mainFileStatus' : 'walFileStatus');
            statusElement.textContent = 'Uploading...';
            statusElement.style.color = '#ffcc00';
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', fileType);
            
            try {
                const response = await fetch('/api/upload-single', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const result = await response.json();
                    uploadedFiles[fileType] = true;
                    statusElement.textContent = '✅ Uploaded successfully (' + (result.size / 1024 / 1024).toFixed(2) + ' MB)';
                    statusElement.style.color = '#4caf50';
                    
                    // If main file is uploaded, show completion message
                    if (fileType === 'main') {
                        showMessage('Main database file uploaded. You can now upload the WAL file or reload the page.', 'success');
                        setTimeout(() => {
                            if (confirm('Database uploaded. Reload the page to see changes?')) {
                                location.reload();
                            }
                        }, 1000);
                    }
                } else {
                    const error = await response.json();
                    statusElement.textContent = '❌ Upload failed: ' + error.error;
                    statusElement.style.color = '#f44336';
                    showMessage('Upload failed: ' + error.error, 'error');
                }
            } catch (error) {
                console.error('Upload error:', error);
                statusElement.textContent = '❌ Connection error';
                statusElement.style.color = '#f44336';
                showMessage('Connection error: ' + error.message, 'error');
            }
        }
        
        async function handleFileSelect(event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            
            console.log('Files selected:', Array.from(files).map(f => f.name));
            
            // Check if this is a single backup file or raw database files
            const isSingleBackup = files.length === 1 && 
                (files[0].name.endsWith('.kuzu') || files[0].name.endsWith('.gz') || files[0].name.endsWith('.zip'));
            
            console.log('Is single backup?', isSingleBackup);
            
            let confirmMessage = 'Are you sure you want to restore from this backup? This will replace the current database.';
            if (!isSingleBackup) {
                // Raw database files
                const fileNames = Array.from(files).map(f => f.name).join(', ');
                confirmMessage = \`Are you sure you want to restore from these files: \${fileNames}? This will replace the current database.\`;
            }
            
            if (!confirm(confirmMessage)) {
                return;
            }
            
            const formData = new FormData();
            
            if (isSingleBackup) {
                // Single backup file
                console.log('Uploading single backup:', files[0].name);
                formData.append('backup', files[0]);
            } else {
                // Multiple raw database files
                let mainFile = null;
                let walFile = null;
                
                for (const file of files) {
                    if (file.name.endsWith('.wal')) {
                        walFile = file;
                        formData.append('walFile', file);
                        console.log('Adding WAL file:', file.name);
                    } else {
                        mainFile = file;
                        formData.append('mainFile', file);
                        console.log('Adding main file:', file.name);
                    }
                }
                
                if (!mainFile) {
                    showMessage('Please select the main database file', 'error');
                    return;
                }
                console.log('Uploading raw database files - Main:', mainFile.name, 'WAL:', walFile?.name || 'none');
            }
            
            try {
                showProgress('uploadProgress', 'Uploading database...');
                
                // Use fetch API instead of XHR for better handling of large files
                const baseUrl = window.location.origin;
                const startTime = Date.now();
                
                console.log('Starting upload with fetch API...');
                
                fetch(baseUrl + '/api/restore', {
                    method: 'POST',
                    body: formData,
                    // Don't set Content-Type header, let browser set it with boundary
                })
                .then(async response => {
                    console.log('Upload response received:', response.status);
                    
                    if (response.ok) {
                        const result = await response.json();
                        hideProgress('uploadProgress');
                        showMessage('Database restored successfully! The page will reload.', 'success');
                        console.log('Database restore successful, reloading...');
                        setTimeout(() => location.reload(), 2000);
                    } else {
                        const errorText = await response.text();
                        hideProgress('uploadProgress');
                        
                        try {
                            const errorJson = JSON.parse(errorText);
                            showMessage('Error: ' + (errorJson.error || 'Upload failed'), 'error');
                        } catch (e) {
                            showMessage('Upload failed with status: ' + response.status + ' - ' + errorText, 'error');
                        }
                    }
                })
                .catch(error => {
                    hideProgress('uploadProgress');
                    console.error('Upload error details:', error);
                    
                    // Provide more detailed error information
                    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                        showMessage('Connection failed. The server may not be running or the file is too large for your browser.', 'error');
                        console.error('Failed to fetch - possible causes: server down, CORS, or file too large');
                    } else if (error.name === 'AbortError') {
                        showMessage('Upload was cancelled or timed out.', 'error');
                    } else {
                        showMessage('Upload error: ' + error.message, 'error');
                    }
                    
                    console.error('Full error:', error);
                });
                
                // Simulate progress since fetch doesn't support upload progress natively
                const progressInterval = setInterval(() => {
                    const elapsed = Date.now() - startTime;
                    const estimatedProgress = Math.min(90, elapsed / 100); // Estimate based on time
                    updateProgress('uploadProgress', estimatedProgress);
                    document.getElementById('uploadProgressText').textContent = 
                        \`Uploading... \${Math.round(estimatedProgress)}%\`;
                }, 100);
                
                // Clear interval when upload completes
                setTimeout(() => clearInterval(progressInterval), 30000); // Max 30 seconds
                
            } catch (error) {
                hideProgress('uploadProgress');
                showMessage('Error preparing upload: ' + error.message, 'error');
                console.error('Upload preparation error:', error);
            }
        }
    </script>
</body>
</html>`
}
