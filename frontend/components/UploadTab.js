import React, {useState, useRef, useCallback} from 'react';
import {
    Box,
    Button,
    FieldPickerSynced,
    FormField,
    Icon,
    Input,
    Select,
    Text,
    useBase,
    useGlobalConfig,
    useRecords,
    useSession,
} from '@airtable/blocks/ui';
import {FieldType} from '@airtable/blocks/models';
import {cursor} from '@airtable/blocks';

const EXPIRY_OPTIONS = [
    {value: 'never', label: 'No expiry'},
    {value: '1', label: '1 day'},
    {value: '7', label: '7 days'},
    {value: '30', label: '30 days'},
    {value: 'custom', label: 'Custom date'},
];

export default function UploadTab() {
    const base = useBase();
    const globalConfig = useGlobalConfig();
    const session = useSession();
    const apiKey = globalConfig.get('apiKey');
    const defaultExpiry = globalConfig.get('defaultExpiry') || 'never';

    const activeTable = base.getTableByIdIfExists(cursor.activeTableId);
    const destFieldId = globalConfig.get('destUrlFieldId');

    // Only load the fields we actually need (destination field) to limit data loaded
    const recordQueryOpts = destFieldId ? {fields: [destFieldId]} : {fields: []};
    const records = useRecords(activeTable, recordQueryOpts);

    // Check if user has permission to update records
    const updateRecordCheckResult = activeTable
        ? activeTable.checkPermissionsForUpdateRecord()
        : {hasPermission: false, reasonDisplayString: 'No active table selected.'};
    const canUpdateRecords = updateRecordCheckResult.hasPermission;

    const [selectedRecordId, setSelectedRecordId] = useState(null);
    const [file, setFile] = useState(null);
    const [expiry, setExpiry] = useState(defaultExpiry);
    const [customDate, setCustomDate] = useState('');
    const [uploading, setUploading] = useState(false);
    const [resultUrl, setResultUrl] = useState('');
    const [resultMessage, setResultMessage] = useState('');
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [copied, setCopied] = useState(false);

    const fileInputRef = useRef(null);

    const selectedRecord = selectedRecordId && records
        ? records.find(r => r.id === selectedRecordId)
        : null;

    const recordOptions = records
        ? records.map(record => ({
              value: record.id,
              label: record.name || record.id,
          }))
        : [];

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles.length > 0) {
            setFile(droppedFiles[0]);
            setResultUrl('');
            setResultMessage('');
            setError('');
        }
    }

    function handleFileSelect(e) {
        if (e.target.files.length > 0) {
            setFile(e.target.files[0]);
            setResultUrl('');
            setResultMessage('');
            setError('');
        }
    }

    function getExpiryDays() {
        if (expiry === 'custom') {
            if (!customDate) return 'never';
            const now = new Date();
            const target = new Date(customDate);
            const diffMs = target - now;
            if (diffMs <= 0) return '1';
            return String(Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        }
        return expiry;
    }

    async function handleUpload() {
        if (!file) {
            setError('Please select a file to upload');
            return;
        }
        if (!apiKey) {
            setError('Please configure your API key in Settings');
            return;
        }

        setUploading(true);
        setError('');
        setResultUrl('');
        setResultMessage('');

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('expiry_days', getExpiryDays());
            formData.append('source', 'airtable');

            const response = await fetch('https://uploadtourl.com/api/upload', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                },
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.message || errData.error || errData.detail || JSON.stringify(errData);
                if (response.status === 413) {
                    throw new Error(`File too large: ${errMsg}`);
                } else if (response.status === 429) {
                    throw new Error(`Rate limit exceeded: ${errMsg}`);
                } else if (response.status === 402 || response.status === 403) {
                    throw new Error(`API credits exhausted or unauthorized: ${errMsg}`);
                }
                throw new Error(errMsg || `Upload failed (${response.status})`);
            }

            const data = await response.json();
            const publicUrl = data.url;
            setResultUrl(publicUrl);

            // Write to record if one is selected and a destination field is configured
            if (selectedRecordId && destFieldId && activeTable) {
                const field = activeTable.getFieldByIdIfExists(destFieldId);
                if (field) {
                    const writeCheck = activeTable.checkPermissionsForUpdateRecord(
                        selectedRecordId,
                        {[destFieldId]: publicUrl}
                    );
                    if (!writeCheck.hasPermission) {
                        setResultMessage(
                            `Upload complete, but could not save to record: ${writeCheck.reasonDisplayString}`
                        );
                    } else {
                        await activeTable.updateRecordAsync(selectedRecordId, {
                            [destFieldId]: publicUrl,
                        });
                        setResultMessage('URL written to record successfully!');
                    }
                } else {
                    setResultMessage('Upload complete! Select a destination field to save to record.');
                }
            } else {
                setResultMessage('Upload complete!');
            }
        } catch (err) {
            setError(err.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    }

    const copyToClipboard = useCallback(() => {
        navigator.clipboard.writeText(resultUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [resultUrl]);

    if (!apiKey) {
        return (
            <Box padding={3} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
                <Icon name="settings" size={24} marginBottom={2} />
                <Text size="large" marginBottom={2}>Setup Required</Text>
                <Text textColor="light">
                    Please configure your API key in Settings to start uploading.
                </Text>
            </Box>
        );
    }

    return (
        <Box padding={3} overflow="auto" maxHeight="100vh">
            {/* Record Selector */}
            <Box marginBottom={3}>
                <FormField label="Select a record">
                    <Select
                        options={[{value: '', label: 'Choose a record...'}, ...recordOptions]}
                        value={selectedRecordId || ''}
                        onChange={value => {
                            setSelectedRecordId(value || null);
                            setResultMessage('');
                        }}
                    />
                </FormField>
            </Box>

            {/* File Drop Zone */}
            <Box marginBottom={3}>
                <FormField label="Upload a file">
                    <Box
                        border={isDragging ? 'thick' : 'default'}
                        borderRadius="large"
                        padding={3}
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={isDragging ? 'lightBlue1' : 'lightGray1'}
                        style={{
                            minHeight: '120px',
                            cursor: 'pointer',
                            borderStyle: 'dashed',
                        }}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    >
                        <Icon name="upload" size={24} marginBottom={1} />
                        {file ? (
                            <Text fontWeight="strong">{file.name} ({(file.size / 1024).toFixed(1)} KB)</Text>
                        ) : (
                            <Text textColor="light">
                                Drag & drop a file here, or click to browse
                            </Text>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            style={{display: 'none'}}
                            onChange={handleFileSelect}
                        />
                    </Box>
                </FormField>
            </Box>

            {/* Expiry Picker */}
            <Box marginBottom={3}>
                <FormField label="Link expiry">
                    <Select
                        options={EXPIRY_OPTIONS}
                        value={expiry}
                        onChange={value => setExpiry(value)}
                    />
                </FormField>
                {expiry === 'custom' && (
                    <Box marginTop={1}>
                        <Input
                            type="datetime-local"
                            value={customDate}
                            onChange={e => setCustomDate(e.target.value)}
                        />
                    </Box>
                )}
            </Box>

            {/* Destination Field */}
            {activeTable && (
                <Box marginBottom={3}>
                    <FormField label="Save URL to record">
                        <FieldPickerSynced
                            table={activeTable}
                            globalConfigKey="destUrlFieldId"
                            allowedTypes={[FieldType.URL, FieldType.SINGLE_LINE_TEXT]}
                            placeholder="Pick a URL or text field"
                            disabled={!canUpdateRecords}
                        />
                    </FormField>
                    {!canUpdateRecords && (
                        <Text textColor="#ef4444" size="small" marginTop={1}>
                            {updateRecordCheckResult.reasonDisplayString}
                        </Text>
                    )}
                </Box>
            )}

            {/* Upload Button */}
            <Box marginBottom={3}>
                <Button
                    onClick={handleUpload}
                    variant="primary"
                    disabled={!file || uploading}
                    icon={uploading ? undefined : 'upload'}
                    width="100%"
                >
                    {uploading ? 'Uploading...' : 'Upload & Get URL'}
                </Button>
            </Box>

            {/* Error */}
            {error && (
                <Box
                    marginBottom={3}
                    padding={2}
                    borderRadius="default"
                    backgroundColor="lightGray1"
                >
                    <Text textColor="#ef4444">
                        <Icon name="warning" size={12} marginRight={1} />
                        {error}
                    </Text>
                </Box>
            )}

            {/* Result Area */}
            {resultUrl && (
                <Box
                    padding={3}
                    borderRadius="large"
                    backgroundColor="lightGray1"
                    marginBottom={3}
                >
                    <Text fontWeight="strong" marginBottom={1}>
                        Public URL
                    </Text>
                    <Box display="flex" alignItems="center" marginBottom={2}>
                        <Input value={resultUrl} readOnly flex="1" />
                        <Button
                            onClick={copyToClipboard}
                            variant="secondary"
                            size="small"
                            marginLeft={1}
                            icon="link"
                        >
                            {copied ? 'Copied!' : 'Copy'}
                        </Button>
                    </Box>
                    {resultMessage && (
                        <Box display="flex" alignItems="center">
                            <Icon name="check" size={16} fillColor="#22c55e" />
                            <Text textColor="#22c55e" marginLeft={1}>
                                {resultMessage}
                            </Text>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}
