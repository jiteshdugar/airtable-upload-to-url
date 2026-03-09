import React, {useState} from 'react';
import {
    Box,
    Button,
    Icon,
    Text,
    useGlobalConfig,
    useSettingsButton,
} from '@airtable/blocks/ui';

import UploadTab from './components/UploadTab';
import BulkConvertTab from './components/BulkConvertTab';
import SettingsView from './components/SettingsView';

const TABS = {
    UPLOAD: 'upload',
    BULK: 'bulk',
};

export default function UploadToUrlApp() {
    const globalConfig = useGlobalConfig();
    const apiKey = globalConfig.get('apiKey');

    const [activeTab, setActiveTab] = useState(TABS.UPLOAD);
    const [showSettings, setShowSettings] = useState(!apiKey);

    // Surface settings via the SettingsButton API (gear icon outside extension frame)
    useSettingsButton(function () {
        setShowSettings(!showSettings);
    });

    // Show settings on first launch if no API key
    if (showSettings) {
        return <SettingsView onClose={apiKey ? () => setShowSettings(false) : null} />;
    }

    return (
        <Box display="flex" flexDirection="column" height="100vh">
            {/* Header / Tab Bar */}
            <Box
                display="flex"
                alignItems="center"
                borderBottom="thick"
                paddingX={2}
                backgroundColor="white"
                style={{flexShrink: 0}}
            >
                {/* Tab Buttons */}
                <Box display="flex" flex="1">
                    <TabButton
                        label="Upload & Attach"
                        icon="upload"
                        isActive={activeTab === TABS.UPLOAD}
                        onClick={() => setActiveTab(TABS.UPLOAD)}
                    />
                    <TabButton
                        label="Bulk Convert"
                        icon="redo"
                        isActive={activeTab === TABS.BULK}
                        onClick={() => setActiveTab(TABS.BULK)}
                    />
                </Box>

                {/* Settings Gear */}
                <Button
                    icon="cog"
                    variant="secondary"
                    size="small"
                    onClick={() => setShowSettings(true)}
                    aria-label="Settings"
                    style={{marginLeft: 'auto'}}
                />
            </Box>

            {/* Tab Content */}
            <Box flex="1" overflow="auto">
                {activeTab === TABS.UPLOAD && <UploadTab />}
                {activeTab === TABS.BULK && <BulkConvertTab />}
            </Box>
        </Box>
    );
}

function TabButton({label, icon, isActive, onClick}) {
    return (
        <Box
            paddingX={2}
            paddingY={2}
            style={{
                cursor: 'pointer',
                borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
                userSelect: 'none',
            }}
            onClick={onClick}
        >
            <Box display="flex" alignItems="center">
                <Icon
                    name={icon}
                    size={14}
                    marginRight={1}
                    fillColor={isActive ? '#2563eb' : undefined}
                />
                <Text
                    fontWeight={isActive ? 'strong' : 'default'}
                    textColor={isActive ? '#2563eb' : 'default'}
                    size="small"
                >
                    {label}
                </Text>
            </Box>
        </Box>
    );
}
