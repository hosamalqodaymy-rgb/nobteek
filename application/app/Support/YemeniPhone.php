<?php

namespace App\Support;

class YemeniPhone
{
    public static function normalize(?string $phone): ?string
    {
        if ($phone === null || trim($phone) === '') {
            return null;
        }
        $phone = strtr($phone, array_combine(preg_split('//u', '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', -1, PREG_SPLIT_NO_EMPTY), str_split('01234567890123456789')));
        $phone = preg_replace('/[\s()\-]/u', '', $phone);
        if (preg_match('/^7[0-9]{8}$/D', $phone)) {
            $phone = '+967'.$phone;
        } elseif (preg_match('/^009677[0-9]{8}$/D', $phone)) {
            $phone = '+'.substr($phone, 2);
        } elseif (preg_match('/^9677[0-9]{8}$/D', $phone)) {
            $phone = '+'.$phone;
        }

        return $phone;
    }
}
