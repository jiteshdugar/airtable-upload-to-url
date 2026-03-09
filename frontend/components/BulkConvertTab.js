import React, {useState} from 'react';
import {
    Box,
    Button,
    FieldPickerSynced,
    FormField,
    Heading,
    Icon,
    ProgressBar,
    Select,
    Switch,
    TablePickerSynced,
    Text,
    ViewPickerSynced,
    useBase,
    useGlobalConfig,
    useRecords,
    useSession,
} from '@airtable/blocks/ui';
import {FieldType} from '@airtable/blocks/models';

const EXPIRY_OPTIONS = [
    {value: 'never', label: 'No expiry'},
    {value: '1', label: '1 day'},
    {value: '7', label: '7 days'},
    {value: '30', label: '30 days'},
];

const MAX_RECORDS_PER_UPDATE = 50;

export default function BulkConvertTab() {
    const base = useBase();
    const globalConfig = useGlobalConfig();
    const session = useSession();
    const apiKey = globalConfig.get('apiKey');
    const defaultExpiry = globalConfig.get('defaultExpiry') || 'never';

    const selectedTableId = globalConfig.get('bulkTableId');
    const sourceFieldId = globalConfig.get('bulkSourceFieldId');
    const destFieldId = globalConfig.get('bulkDestFieldId');
    const selectedViewId = globalConfig.get('bulkViewId');

    const selectedTable = selectedTableId
        ? base.getTableByIdIfExists(selectedTableId)
        : null;

    const selectedView = selectedTable && selectedViewId
        ? selectedTable.getViewByIdIfExists(selectedViewId)
        : null;

    // Only load the fields we need to limit data loaded
    const fieldsToLoad = [sourceFieldId, destFieldId].filter(Boolean);
    const recordQueryOpts = fieldsToLoad.length > 0 ? {fields: fieldsToLoad} : {fields: []};
    const records = useRecords(selectedView || selectedTable, recordQueryOpts);

    // Check if user has permission to update records
    const updateCheckResult = selectedTable
        ? selectedTable.checkPermissionsForUpdateRecord()
        : {hasPermission: false, reasonDisplayString: 'No table selected.'};
    const canUpdateRecords = updateCheckResult.hasPermission;

    const [expiry, setExpiry] = useState(defaultExpiry);
    const [skipExisting, setSkipExisting] = useState(true);
    const [converting, setConverting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [totalToConvert, setTotalToConvert] = useState(0);
    const [successCount, setSuccessCount] = useState(0);
    const [errorCount, setErrorCount] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [log, setLog] = useState([]);

    function addLogEntry(message, type = 'info') {
        setLog(prev => [...prev, {message, type, time: new Date().toLocaleTimeString()}]);
    }

    async function uploadFileFromUrl(fileUrl, fileName) {
        // Fetch the file from Airtable's CDN, then re-upload to UploadToURL
        const fileResponse = await fetch(fileUrl);
        const blob = await fileResponse.blob();

        const formData = new FormData();
        formData.append('file', blob, fileName);
        formData.append('expiry_days', expiry);
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
        return data.url;
    }

    async function handleConvertAll() {
        if (!selectedTable || !sourceFieldId || !destFieldId || !apiKey) {
            setStatusMessage('Please configure all fields before converting.');
            return;
        }

        if (!records || records.length === 0) {
            setStatusMessage('No records found in the selected table.');
            return;
        }

        const sourceField = selectedTable.getFieldByIdIfExists(sourceFieldId);
        const destField = selectedTable.getFieldByIdIfExists(destFieldId);

        if (!sourceField || !destField) {
            setStatusMessage('Selected fields no longer exist.');
            return;
        }

        const permCheck = selectedTable.checkPermissionsForUpdateRecord();
        if (!permCheck.hasPermission) {
            setStatusMessage(permCheck.reasonDisplayString);
            return;
        }

        setConverting(true);
        setProgress(0);
        setSuccessCount(0);
        setErrorCount(0);
        setLog([]);

        // Filter records that have attachments in the source field
        const recordsWithAttachments = records.filter(record => {
            const attachments = record.getCellValue(sourceFieldId);
            if (!attachments || attachments.length === 0) return false;
            // Optionally skip records that already have a value in the destination field
            if (skipExisting) {
                const destValue = record.getCellValue(destFieldId);
                if (destValue && (Array.isArray(destValue) ? destValue.length > 0 : destValue.toString().trim() !== '')) {
                    return false;
                }
            }
            return true;
        });

        setTotalToConvert(recordsWithAttachments.length);

        if (recordsWithAttachments.length === 0) {
            setStatusMessage('No records have attachments in the selected field.');
            setConverting(false);
            return;
        }

        addLogEntry(`Starting bulk conversion of ${recordsWithAttachments.length} records...`);

        let successTotal = 0;
        let errorTotal = 0;

        // Process records and batch updates
        const updates = [];

        for (let i = 0; i < recordsWithAttachments.length; i++) {
            const record = recordsWithAttachments[i];
            const attachments = record.getCellValue(sourceFieldId);
            const recordName = record.name || record.id;

            try {
                // Upload each attachment and collect URLs
                const urls = [];
                for (const attachment of attachments) {
                    const publicUrl = await uploadFileFromUrl(
                        attachment.url,
                        attachment.filename || 'file'
                    );
                    urls.push(publicUrl);
                }

                // Determine value based on destination field type
                let cellValue;
                if (destField.type === FieldType.MULTIPLE_ATTACHMENTS) {
                    cellValue = urls.map((url, idx) => ({
                        url,
                        filename: attachments[idx]?.filename || 'file',
                    }));
                } else {
                    // URL or text field — join multiple URLs with newlines
                    cellValue = urls.join('\n');
                }

                updates.push({
                    id: record.id,
                    fields: {[destFieldId]: cellValue},
                });

                successTotal++;
                addLogEntry(`${recordName}: ${urls.length} file(s) uploaded`, 'success');
            } catch (err) {
                errorTotal++;
                addLogEntry(`${recordName}: ${err.message}`, 'error');
            }

            setProgress(i + 1);
            setSuccessCount(successTotal);
            setErrorCount(errorTotal);
        }

        // Batch update records (max 50 at a time)
        if (updates.length > 0) {
            addLogEntry(`Writing ${updates.length} records to destination field...`);
            try {
                for (let i = 0; i < updates.length; i += MAX_RECORDS_PER_UPDATE) {
                    const batch = updates.slice(i, i + MAX_RECORDS_PER_UPDATE);
                    await selectedTable.updateRecordsAsync(batch);
                }
                addLogEntry(`All records updated successfully!`, 'success');
            } catch (err) {
                addLogEntry(`Error writing records: ${err.message}`, 'error');
            }
        }

        setStatusMessage(
            `Done! ${successTotal} succeeded, ${errorTotal} failed out of ${recordsWithAttachments.length} records.`
        );
        setConverting(false);
    }

    if (!apiKey) {
        return (
            <Box padding={3} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
                <Icon name="settings" size={24} marginBottom={2} />
                <Text size="large" marginBottom={2}>Setup Required</Text>
                <Text textColor="light">
                    Please configure your API key in Settings to start converting.
                </Text>
            </Box>
        );
    }

    const progressFraction = totalToConvert > 0 ? progress / totalToConvert : 0;

    return (
        <Box padding={3} overflow="auto" maxHeight="100vh">
            <Box marginBottom={2}>
                <Text size="large" fontWeight="strong">Bulk Convert Attachments to URLs</Text>
                <Text textColor="light" marginTop={1}>
                    Convert all attachments in a field to stable public URLs via UploadToURL.
                </Text>
            </Box>

            {/* Table Picker */}
            <Box marginBottom={3}>
                <FormField label="Select table">
                    <TablePickerSynced globalConfigKey="bulkTableId" />
                </FormField>
            </Box>

            {/* View Picker */}
            {selectedTable && (
                <Box marginBottom={3}>
                    <FormField label="Select view (optional)">
                        <ViewPickerSynced
                            table={selectedTable}
                            globalConfigKey="bulkViewId"
                            shouldAllowPickingNone={true}
                        />
                    </FormField>
                </Box>
            )}

            {selectedTable && (
                <>
                    {/* Source Field (Attachments) */}
                    <Box marginBottom={3}>
                        <FormField label="Source attachment field">
                            <FieldPickerSynced
                                table={selectedTable}
                                globalConfigKey="bulkSourceFieldId"
                                allowedTypes={[FieldType.MULTIPLE_ATTACHMENTS]}
                                placeholder="Pick an attachment field"
                            />
                        </FormField>
                    </Box>

                    {/* Destination Field */}
                    <Box marginBottom={3}>
                        <FormField label="Destination field (for public URLs)">
                            <FieldPickerSynced
                                table={selectedTable}
                                globalConfigKey="bulkDestFieldId"
                                allowedTypes={[
                                    FieldType.URL,
                                    FieldType.SINGLE_LINE_TEXT,
                                    FieldType.MULTILINE_TEXT,
                                    FieldType.MULTIPLE_ATTACHMENTS,
                                ]}
                                placeholder="Pick a URL, text, or attachment field"
                            />
                        </FormField>
                    </Box>
                </>
            )}

            {/* Expiry */}
            <Box marginBottom={3}>
                <FormField label="Expiry for all uploads">
                    <Select
                        options={EXPIRY_OPTIONS}
                        value={expiry}
                        onChange={value => setExpiry(value)}
                    />
                </FormField>
            </Box>

            {/* Skip existing toggle */}
            {selectedTable && destFieldId && (
                <Box marginBottom={3}>
                    <Switch
                        value={skipExisting}
                        onChange={value => setSkipExisting(value)}
                        label="Skip records that already have a destination value"
                    />
                </Box>
            )}

            {/* Record count info */}
            {records && selectedTable && sourceFieldId && (
                <Box marginBottom={3}>
                    <Text textColor="light" size="small">
                        {records.length} records{selectedView ? ' in view' : ' in table'}
                        {' · '}
                        {(() => {
                            const withAttachments = records.filter(r => {
                                const v = r.getCellValue(sourceFieldId);
                                return v && v.length > 0;
                            }).length;
                            const toConvert = skipExisting && destFieldId
                                ? records.filter(r => {
                                    const v = r.getCellValue(sourceFieldId);
                                    if (!v || v.length === 0) return false;
                                    const dv = r.getCellValue(destFieldId);
                                    if (dv && (Array.isArray(dv) ? dv.length > 0 : dv.toString().trim() !== '')) return false;
                                    return true;
                                }).length
                                : withAttachments;
                            return `${withAttachments} with attachments` +
                                (skipExisting && destFieldId && toConvert !== withAttachments
                                    ? ` · ${toConvert} to convert`
                                    : '');
                        })()}
                    </Text>
                </Box>
            )}

            {/* Convert Button */}
            <Box marginBottom={3}>
                <Button
                    onClick={handleConvertAll}
                    variant="primary"
                    disabled={converting || !selectedTable || !sourceFieldId || !destFieldId || !canUpdateRecords}
                    width="100%"
                >
                    {converting ? 'Converting...' : 'Convert All'}
                </Button>
                {selectedTable && !canUpdateRecords && (
                    <Text textColor="#ef4444" size="small" marginTop={1}>
                        {updateCheckResult.reasonDisplayString}
                    </Text>
                )}
            </Box>

            {/* Progress Bar */}
            {converting && totalToConvert > 0 && (
                <Box marginBottom={3}>
                    <ProgressBar progress={progressFraction} barColor="#2563eb" />
                    <Text size="small" textColor="light" marginTop={1}>
                        {progress} / {totalToConvert} records processed
                        {successCount > 0 && ` · ${successCount} succeeded`}
                        {errorCount > 0 && ` · ${errorCount} failed`}
                    </Text>
                </Box>
            )}

            {/* Status Message */}
            {statusMessage && !converting && (
                <Box
                    marginBottom={3}
                    padding={2}
                    borderRadius="default"
                    backgroundColor="lightGray1"
                >
                    <Text fontWeight="strong">{statusMessage}</Text>
                </Box>
            )}

            {/* Log */}
            {log.length > 0 && (
                <Box marginBottom={3}>
                    <Text fontWeight="strong" marginBottom={1}>Log</Text>
                    <Box
                        backgroundColor="lightGray1"
                        borderRadius="default"
                        padding={2}
                        style={{maxHeight: '200px', overflowY: 'auto'}}
                    >
                        {log.map((entry, idx) => (
                            <Box key={idx} marginBottom="2px">
                                <Text
                                    size="small"
                                    textColor={
                                        entry.type === 'error'
                                            ? '#ef4444'
                                            : entry.type === 'success'
                                            ? '#22c55e'
                                            : 'light'
                                    }
                                >
                                    [{entry.time}] {entry.message}
                                </Text>
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
        </Box>
    );
}
