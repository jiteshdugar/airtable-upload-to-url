import React, {useState} from 'react';
import {
    Box,
    Button,
    FormField,
    Heading,
    Icon,
    Input,
    Link,
    Select,
    Text,
    useGlobalConfig,
    useSession,
} from '@airtable/blocks/ui';

const EXPIRY_OPTIONS = [
    {value: 'never', label: 'No expiry'},
    {value: '1', label: '1 day'},
    {value: '7', label: '7 days'},
    {value: '30', label: '30 days'},
];

export default function SettingsView({onClose}) {
    const globalConfig = useGlobalConfig();
    const session = useSession();
    const savedApiKey = globalConfig.get('apiKey') || '';
    const savedDefaultExpiry = globalConfig.get('defaultExpiry') || 'never';

    // Only editors and above can update GlobalConfig
    const globalConfigPermCheck = globalConfig.checkPermissionsForSet();
    const canUpdateGlobalConfig = globalConfigPermCheck.hasPermission;

    const [apiKey, setApiKey] = useState(savedApiKey);
    const [defaultExpiry, setDefaultExpiry] = useState(savedDefaultExpiry);
    const [validationState, setValidationState] = useState(
        savedApiKey ? 'saved' : 'idle'
    ); // idle | validating | valid | invalid | saved
    const [credits, setCredits] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');

    async function verifyApiKey() {
        if (!apiKey.trim()) {
            setValidationState('invalid');
            setErrorMessage('Please enter an API key');
            return;
        }

        setValidationState('validating');
        setErrorMessage('');

        try {
            const response = await fetch(
                'https://uploadtourl.com/api/api-key/verify',
                {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        'x-api-key': apiKey.trim(),
                    },
                }
            );

            const data = await response.json();

            if (data.valid) {
                setValidationState('valid');
                setCredits(data.credits);
            } else {
                setValidationState('invalid');
                setErrorMessage('Invalid API key');
            }
        } catch (err) {
            setValidationState('invalid');
            setErrorMessage('Failed to verify API key. Please check your connection.');
        }
    }

    async function saveSettings() {
        if (validationState !== 'valid' && validationState !== 'saved') {
            return;
        }

        if (!canUpdateGlobalConfig) {
            setErrorMessage(globalConfigPermCheck.reasonDisplayString);
            setValidationState('invalid');
            return;
        }

        await globalConfig.setPathsAsync([
            {path: ['apiKey'], value: apiKey.trim()},
            {path: ['defaultExpiry'], value: defaultExpiry},
        ]);

        setValidationState('saved');
        if (onClose) {
            onClose();
        }
    }

    function getValidationIcon() {
        switch (validationState) {
            case 'valid':
            case 'saved':
                return (
                    <Box display="flex" alignItems="center" marginLeft={2}>
                        <Icon name="check" size={16} fillColor="#22c55e" />
                        <Text textColor="#22c55e" marginLeft={1} size="small">
                            {credits !== null ? `Valid (${credits} credits remaining)` : 'Valid'}
                        </Text>
                    </Box>
                );
            case 'invalid':
                return (
                    <Box display="flex" alignItems="center" marginLeft={2}>
                        <Icon name="x" size={16} fillColor="#ef4444" />
                        <Text textColor="#ef4444" marginLeft={1} size="small">
                            {errorMessage}
                        </Text>
                    </Box>
                );
            case 'validating':
                return (
                    <Box display="flex" alignItems="center" marginLeft={2}>
                        <Text textColor="light" size="small">Verifying...</Text>
                    </Box>
                );
            default:
                return null;
        }
    }

    return (
        <Box padding={3}>
            <Box display="flex" alignItems="center" justifyContent="space-between" marginBottom={3}>
                <Heading size="small">Settings</Heading>
                {onClose && (
                    <Button
                        icon="x"
                        variant="secondary"
                        size="small"
                        onClick={onClose}
                        aria-label="Close settings"
                    />
                )}
            </Box>

            <Box marginBottom={3}>
                <FormField label="API Key">
                    <Box display="flex" alignItems="center">
                        <Input
                            value={apiKey}
                            onChange={e => {
                                setApiKey(e.target.value);
                                setValidationState('idle');
                            }}
                            placeholder="uaf_xxxxx"
                            type="password"
                            flex="1"
                        />
                        <Button
                            onClick={verifyApiKey}
                            marginLeft={2}
                            variant="secondary"
                            size="small"
                            disabled={validationState === 'validating'}
                        >
                            Verify
                        </Button>
                    </Box>
                    {getValidationIcon()}
                </FormField>
                <Link
                    href="https://uploadtourl.com/dashboard"
                    target="_blank"
                    size="small"
                    marginTop={1}
                >
                    Get your API key from uploadtourl.com/dashboard
                </Link>
            </Box>

            <Box marginBottom={3}>
                <FormField label="Default expiry for uploads">
                    <Select
                        options={EXPIRY_OPTIONS}
                        value={defaultExpiry}
                        onChange={value => setDefaultExpiry(value)}
                    />
                </FormField>
            </Box>

            <Button
                onClick={saveSettings}
                variant="primary"
                disabled={!canUpdateGlobalConfig || (validationState !== 'valid' && validationState !== 'saved')}
            >
                Save Settings
            </Button>
            {!canUpdateGlobalConfig && (
                <Text textColor="#ef4444" size="small" marginTop={2}>
                    {globalConfigPermCheck.reasonDisplayString}
                </Text>
            )}
        </Box>
    );
}
