document.addEventListener('DOMContentLoaded', () => {
    // --- 設定項目 ---
    const OBS_WEBSOCKET_URL = 'ws://127.0.0.1:4455';
    // 重要：OBSのWebSocketサーバー設定で確認したパスワードに変更してください
    const OBS_WEBSOCKET_PASSWORD = 'A2r3rw2egfw6'; 
    const SOURCE_NAMES = ['pip1', 'pip2', 'vdj'];
    const FILTER_NAME = 'OpacityControl';

    // --- グローバル変数 ---
    const obs = new OBSWebSocket();
    let connectionInterval;

    // --- DOM要素の取得 ---
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const errorMessage = document.getElementById('error-message');
    const reconnectBtn = document.getElementById('reconnect-btn');
    const reloadBtn = document.getElementById('reload-btn');

    // --- デバッグ関数 ---
    const debugOBSState = async () => {
        try {
            // 利用可能なソースを取得
            const sourcesResponse = await obs.call('GetSceneList');
            console.log('=== デバッグ情報 ===');
            console.log('利用可能なシーン:', sourcesResponse.responseData.scenes);

            // 各シーンのソースを取得
            for (const scene of sourcesResponse.responseData.scenes) {
                const sceneItemsResponse = await obs.call('GetSceneItemList', {
                    sceneName: scene.sceneName
                });
                console.log(`シーン "${scene.sceneName}" のソース:`, sceneItemsResponse.responseData.sceneItems);

                // 各ソースのフィルターを取得
                for (const item of sceneItemsResponse.responseData.sceneItems) {
                    try {
                        const filtersResponse = await obs.call('GetSourceFilterList', {
                            sourceName: item.sourceName
                        });
                        console.log(`ソース "${item.sourceName}" のフィルター:`, filtersResponse.responseData.filters);
                    } catch (filterError) {
                        console.warn(`ソース "${item.sourceName}" のフィルター取得失敗:`, filterError.message);
                    }
                }
            }
        } catch (error) {
            console.error('デバッグ情報の取得に失敗:', error);
        }
    };

    // --- 接続管理 ---
    const setStatus = (state, message) => {
        statusIndicator.className = `status ${state}`;
        statusText.textContent = message;

        // 再接続ボタンの状態を更新
        if (state === 'connecting') {
            reconnectBtn.disabled = true;
            reconnectBtn.textContent = '接続中...';
        } else if (state === 'connected') {
            reconnectBtn.disabled = true;
            reconnectBtn.textContent = '接続済み';
        } else if (state === 'error') {
            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '再接続';
        }

        if (state === 'error') {
            console.error(message);
        }
    };

    const connectToOBS = async () => {
        setStatus('connecting', 'Connecting...');
        errorMessage.textContent = '';
        try {
            await obs.connect(OBS_WEBSOCKET_URL, OBS_WEBSOCKET_PASSWORD);
            setStatus('connected', 'Connected');
            clearInterval(connectionInterval);
            connectionInterval = null;

            // デバッグ情報を取得
            await debugOBSState();

            await syncInitialState();
        } catch (error) {
            setStatus('error', 'Connection Failed');
            let msg = 'OBSへの接続に失敗しました。';
            if (error.code === 'CONNECTION_ERROR') {
                msg += 'OBSが起動しているか、WebSocketサーバーが有効になっているか確認してください。';
            } else if (error.code === 'AUTHENTICATION_FAILED') {
                msg += 'パスワードが正しくありません。app.jsファイルを確認してください。';
            } else {
                msg += `詳細: ${error.message}`;
            }
            errorMessage.textContent = msg;
            
            if (!connectionInterval) {
                connectionInterval = setInterval(connectToOBS, 5000); // 5秒ごとに再接続を試みる
            }
        }
    };

    // --- APIリクエスト ---
    const setOpacity = async (sourceName, opacityValue) => {
        try {
            await obs.call('SetSourceFilterSettings', {
                sourceName: sourceName,
                filterName: FILTER_NAME,
                filterSettings: {
                    opacity: opacityValue
                },
                overlay: true
            });
        } catch (error) {
            const msg = `Error setting opacity for ${sourceName}: ${error.message}`;
            errorMessage.textContent = msg;
            console.error(msg);
        }
    };

    const executeSolo = async (soloSourceName) => {
        const FADE_DURATION = 500; // ms
        const STEPS = 20; // 20ステップで滑らかに遷移
        const STEP_INTERVAL = FADE_DURATION / STEPS;

        try {
            // 現在の全ソースの不透明度を取得
            const currentOpacities = {};
            for (const sourceName of SOURCE_NAMES) {
                try {
                    const response = await obs.call('GetSourceFilter', {
                        sourceName: sourceName,
                        filterName: FILTER_NAME
                    });

                    // フィルターが存在しない場合のエラーハンドリング
                    if (!response.responseData || !response.responseData.filterSettings) {
                        errorMessage.textContent = `フィルター '${FILTER_NAME}' がソース '${sourceName}' に見つかりません`;
                        console.error(`Filter '${FILTER_NAME}' not found on source '${sourceName}'`);
                        return;
                    }

                    currentOpacities[sourceName] = response.responseData.filterSettings.opacity || 0;
                } catch (filterError) {
                    errorMessage.textContent = `ソース '${sourceName}' のフィルター取得に失敗: ${filterError.message}`;
                    console.error(`Failed to get filter for ${sourceName}:`, filterError);
                    return;
                }
            }

            // 目標の不透明度を設定
            const targetOpacities = {};
            SOURCE_NAMES.forEach(sourceName => {
                targetOpacities[sourceName] = sourceName === soloSourceName ? 1.0 : 0.0;
            });

            // フェードアニメーションを実行
            for (let step = 1; step <= STEPS; step++) {
                const progress = step / STEPS;

                // 各ソースの不透明度を段階的に更新
                const requests = SOURCE_NAMES.map(sourceName => ({
                    requestType: 'SetSourceFilterSettings',
                    requestData: {
                        sourceName: sourceName,
                        filterName: FILTER_NAME,
                        filterSettings: {
                            opacity: currentOpacities[sourceName] +
                                      (targetOpacities[sourceName] - currentOpacities[sourceName]) * progress
                        },
                        overlay: true
                    }
                }));

                await obs.callBatch(requests);

                // GUIのフェーダーもリアルタイムに更新
                SOURCE_NAMES.forEach(sourceName => {
                    const fader = document.getElementById(`${sourceName}-fader`);
                    const valueDisplay = document.getElementById(`${sourceName}-value`);
                    const currentOpacity = currentOpacities[sourceName] +
                                         (targetOpacities[sourceName] - currentOpacities[sourceName]) * progress;
                    const faderValue = Math.round(currentOpacity * 100);
                    fader.value = faderValue;
                    valueDisplay.textContent = `${faderValue}%`;
                });

                // 次のステップまで待機
                if (step < STEPS) {
                    await new Promise(resolve => setTimeout(resolve, STEP_INTERVAL));
                }
            }

            // 最終値を確実に設定
            const finalRequests = SOURCE_NAMES.map(sourceName => ({
                requestType: 'SetSourceFilterSettings',
                requestData: {
                    sourceName: sourceName,
                    filterName: FILTER_NAME,
                    filterSettings: {
                        opacity: targetOpacities[sourceName]
                    },
                    overlay: true
                }
            }));
            await obs.callBatch(finalRequests);

            // GUIの最終値を確実に同期
            SOURCE_NAMES.forEach(sourceName => {
                const fader = document.getElementById(`${sourceName}-fader`);
                const valueDisplay = document.getElementById(`${sourceName}-value`);
                const finalValue = Math.round(targetOpacities[sourceName] * 100);
                fader.value = finalValue;
                valueDisplay.textContent = `${finalValue}%`;
            });

        } catch (error) {
            const msg = `Error executing solo for ${soloSourceName}: ${error.message}`;
            errorMessage.textContent = msg;
            console.error(msg);
        }
    };

    // --- 初期状態の同期 ---
    const syncInitialState = async () => {
        for (const sourceName of SOURCE_NAMES) {
            try {
                const response = await obs.call('GetSourceFilter', {
                    sourceName: sourceName,
                    filterName: FILTER_NAME
                });

                // フィルターが存在しない場合のエラーハンドリング
                if (!response.responseData || !response.responseData.filterSettings) {
                    const msg = `フィルター '${FILTER_NAME}' がソース '${sourceName}' に見つかりません`;
                    errorMessage.textContent = msg;
                    console.error(msg);
                    continue;
                }

                if (typeof response.responseData.filterSettings.opacity === 'number') {
                    const opacity = response.responseData.filterSettings.opacity;
                    const faderValue = Math.round(opacity * 100);
                    document.getElementById(`${sourceName}-fader`).value = faderValue;
                    document.getElementById(`${sourceName}-value`).textContent = `${faderValue}%`;
                }
            } catch (error) {
                 const msg = `ソース '${sourceName}' の初期状態取得に失敗: ${error.message}`;
                 errorMessage.textContent = msg;
                 console.warn(msg);
            }
        }
    };

    // --- イベントリスナーの設定 ---
    SOURCE_NAMES.forEach(sourceName => {
        const fader = document.getElementById(`${sourceName}-fader`);
        const valueDisplay = document.getElementById(`${sourceName}-value`);
        const soloBtn = document.getElementById(`${sourceName}-solo-btn`);

        // フェーダー操作
        fader.addEventListener('input', (event) => {
            const faderValue = parseInt(event.target.value, 10);
            valueDisplay.textContent = `${faderValue}%`;
            const normalizedOpacity = faderValue / 100.0;
            setOpacity(sourceName, normalizedOpacity);
        });

        // SOLOボタン操作
        soloBtn.addEventListener('click', () => {
            executeSolo(sourceName);
        });
    });

    // 再接続ボタン操作
    reconnectBtn.addEventListener('click', async () => {
        setStatus('connecting', 'Manual Reconnecting...');
        errorMessage.textContent = '';

        // 既存の自動再接続をクリア
        if (connectionInterval) {
            clearInterval(connectionInterval);
            connectionInterval = null;
        }

        await connectToOBS();
    });

    // リロードボタン操作
    reloadBtn.addEventListener('click', () => {
        if (confirm('ページをリロードしますか？現在の状態は失われます。')) {
            // 自動再接続をクリア
            if (connectionInterval) {
                clearInterval(connectionInterval);
                connectionInterval = null;
            }

            // OBS接続を切断
            try {
                obs.disconnect();
            } catch (e) {
                console.log('OBS切断エラー:', e);
            }

            // ページをリロード
            window.location.reload();
        }
    });
    
    obs.on('ConnectionClosed', () => {
        setStatus('error', 'Disconnected');
        if (!connectionInterval) {
            connectionInterval = setInterval(connectToOBS, 5000);
        }
    });

    // --- 初期化 ---
    connectToOBS();
});