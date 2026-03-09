import React, {useState, useRef, useCallback} from 'react';
import {
    Box,
    Button,
    FieldPickerSynced,
    FormField,
    Heading,
    Icon,
    Input,
    RecordCardList,
    Select,
    Text,
    useBase,
    useGlobalConfig,
    useRecords,
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
    const apiKey = globalConfig.get('apiKey');
    const defaultExpiry = globalConfig.get('defaultExpiry') || 'never';

    const activeTable = base.getTableByIdIfExists(cursor.activeTableId);
    const records = useRecords(activeTable);

    const [selectedRecordId, setSelectedRecordId] = useState(null);
    const [file, setFile] = useState(null);
    const [expiry, setExpiry] = useState(defaultExpiry);
    const [customDate, setCustomDate] = useState('');
    const [destinationMode, setDestinationMode] = useState('url'); // 'url' or 'attachment'
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
                throw new Error(errData.message || `Upload failed (${response.status})`);
            }

            const data = await response.json();
            const publicUrl = data.url;
            setResultUrl(publicUrl);

            // Write to record if one is selected and a destination field is configured
            const destFieldId = globalConfig.get(
                destinationMode === 'url' ? 'destUrlFieldId' : 'destAttachmentFieldId'
            );

            if (selectedRecordId && destFieldId && activeTable) {
                const field = activeTable.getFieldByIdIfExists(destFieldId);
                if (field) {
                    if (destinationMode === 'url') {
                        await activeTable.updateRecordAsync(selectedRecordId, {
                            [destFieldId]: publicUrl,
                        });
                        setResultMessage('URL written to record successfully!');
                    } else {
                        // Attachment mode — use the public URL
                        const existingAttachments =
                            selectedRecord.getCellValue(destFieldId) || [];
                        await activeTable.updateRecordAsync(selectedRecordId, {
                            [destFieldId]: [
                                ...existingAttachments,
                                {url: publicUrl, filename: file.name},
                            ],
                        });
                        setResultMessage('File attached to record successfully!');
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
                        onChange={value => setSelectedRecordId(value || null)}
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

            {/* Destination Mode Toggle */}
            <Box marginBottom={3}>
                <FormField label="Save URL to record as">
                    <Box display="flex">
                        <Button
                            onClick={() => setDestinationMode('url')}
                            variant={destinationMode === 'url' ? 'primary' : 'secondary'}
                            size="small"
                            marginRight={1}
                        >
                            URL Field
                        </Button>
                        <Button
                            onClick={() => setDestinationMode('attachment')}
                            variant={destinationMode === 'attachment' ? 'primary' : 'secondary'}
                            size="small"
                        >
                            Attachment Field
                        </Button>
                    </Box>
                </FormField>

                {activeTable && (
                    <Box marginTop={1}>
                        {destinationMode === 'url' ? (
                            <FormField label="Destination URL field">
                                <FieldPickerSynced
                                    table={activeTable}
                                    globalConfigKey="destUrlFieldId"
                                    allowedTypes={[FieldType.URL, FieldType.SINGLE_LINE_TEXT]}
                                    placeholder="Pick a URL or text field"
                                />
                            </FormField>
                        ) : (
                            <FormField label="Destination attachment field">
                                <FieldPickerSynced
                                    table={activeTable}
                                    globalConfigKey="destAttachmentFieldId"
                                    allowedTypes={[FieldType.MULTIPLE_ATTACHMENTS]}
                                    placeholder="Pick an attachment field"
                                />
                            </FormField>
                        )}
                    </Box>
                )}
            </Box>

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
