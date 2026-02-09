<?php

namespace MesseAf\Handlers;

use MesseAf\Config;

class Health
{
    public static function check(): array
    {
        return [
            'data' => [
                'status' => 'ok',
                'service' => 'mess-exchange-server',
                'version' => '1.0.0',
                'php_version' => PHP_VERSION,
                'exchange_id' => Config::getExchangeId(),
            ],
            'status' => 200,
        ];
    }
}
