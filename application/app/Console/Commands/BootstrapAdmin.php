<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\AccountSecurity;
use App\Services\SecurityAudit;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class BootstrapAdmin extends Command
{
    protected $signature = 'nobteek:bootstrap-admin {username} {--name=مدير المنصة}';

    protected $description = 'إنشاء أول مدير للمنصة بكلمة مرور مخفية دون بيانات دخول افتراضية';

    public function handle(): int
    {
        $username = strtolower(trim((string) $this->argument('username')));
        if (! $this->input->isInteractive()) {
            $this->error('يتطلب الأمر إدخال كلمة المرور يدويًا وبشكل مخفي.');

            return self::FAILURE;
        }
        $password = $this->secret('كلمة مرور من ١٢ حرفًا على الأقل تتضمن أحرفًا وأرقامًا');
        $confirmation = $this->secret('أعد كلمة المرور');
        $validator = Validator::make(['username' => $username, 'display_name' => $this->option('name'), 'password' => $password, 'password_confirmation' => $confirmation],
            ['username' => ['required', 'regex:/^[a-z][a-z0-9_.-]{3,79}$/D'], 'display_name' => ['required', 'string', 'max:80'], 'password' => AccountSecurity::passwordRules()]);
        if ($validator->fails()) {
            $this->error('بيانات غير صالحة. تحقق من الاسم وقوة كلمة المرور وتطابقها.');

            return self::FAILURE;
        }
        $created = DB::transaction(function () use ($username, $password): bool {
            DB::statement("SELECT pg_advisory_xact_lock(hashtext('nobteek-admin-bootstrap'))");
            if (User::where('platform_role', 'platform_admin')->exists() || User::whereRaw('lower(username) = ?', [$username])->exists()) {
                return false;
            }
            $user = new User;
            $user->forceFill(['username' => $username, 'display_name' => $this->option('name'), 'password' => Hash::make($password), 'platform_role' => 'platform_admin', 'login_enabled' => true])->save();
            app(SecurityAudit::class)->record('platform_admin_bootstrapped', subject: $user->id);

            return true;
        });
        if (! $created) {
            $this->error('يوجد مدير منصة بالفعل أو اسم الدخول مستخدم. لم يُنشأ حساب.');

            return self::FAILURE;
        }
        $this->info('تم إنشاء مدير المنصة. التحقق الإضافي إلزامي عند أول دخول.');

        return self::SUCCESS;
    }
}
