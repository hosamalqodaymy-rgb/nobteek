<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TicketTestCase;

#[Group('postgres')]
class TicketWaitingRoomTest extends TicketTestCase
{
    public function test_hall_has_only_numbers_doctor_identifier_state_and_time_with_five_ordered_next_numbers(): void
    {
        $first = $this->arrivedVisit();
        $last = null;
        for ($number = 2; $number <= 7; $number++) {
            $last = $this->walkIn('مراجع صناعي '.$number)->assertCreated()->json('id');
        }
        $this->doctor();
        $this->doctorAction($last, 'priority', ['reason_code' => 'clinical_priority'])->assertOk();
        $response = $this->waitingRoom()->assertOk()->assertJsonPath('doctor_id', $this->id('DR_C'))->assertJsonPath('session_state', 'open')
            ->assertJsonPath('called_ticket_numbers', [])->assertJsonPath('next_ticket_numbers', [7, 1, 2, 3, 4]);
        $this->assertEqualsCanonicalizing(self::WAITING_ROOM_FIELDS, array_keys($response->json()));
        $content = json_encode($response->json(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        foreach (DB::table('patients')->get() as $patient) {
            foreach ([$patient->id, $patient->display_name, $patient->contact_phone] as $private) {
                if ($private !== null) {
                    $this->assertStringNotContainsString($private, $content);
                }
            }
        }
        $this->assertStringNotContainsString($this->id('BOOK_C1'), $content);
        $this->assertStringNotContainsString($first, $content);
        $this->assertPrivateResponse($response);
        $this->callNext()->assertOk()->assertJsonPath('id', $last);
        $this->waitingRoom()->assertOk()->assertJsonPath('called_ticket_numbers', [7])->assertJsonPath('next_ticket_numbers', [1, 2, 3, 4, 5]);
        $this->doctorAction($last, 'start')->assertOk();
        $this->waitingRoom()->assertOk()->assertJsonPath('called_ticket_numbers', [7]);
        $this->owner();
        $this->visitCommand($first, 'mark-away')->assertOk();
        $this->waitingRoom()->assertOk()->assertJsonPath('next_ticket_numbers', [2, 3, 4, 5, 6]);
    }

    public function test_hall_is_available_only_to_authorized_staff_and_doctors_see_only_their_sessions(): void
    {
        $this->waitingRoom()->assertOk();
        $this->waitingRoom($this->id('SESSION_B'))->assertNotFound();
        $this->waitingRoom((string) Str::uuid())->assertNotFound();
        $this->signIn('RECEPTION_A');
        $this->waitingRoom()->assertOk();
        $this->waitingRoom($this->id('SESSION_A'))->assertOk();
        $this->waitingRoom($this->id('SESSION_B'))->assertNotFound();
        $this->doctor();
        $this->waitingRoom()->assertOk();
        $this->waitingRoom($this->id('SESSION_A'))->assertNotFound();
        $this->waitingRoom($this->id('SESSION_B'))->assertNotFound();
        $this->get('/workspace/sessions/'.$this->id('SESSION_A').'/waiting')->assertNotFound();
        $this->signIn('PLATFORM', true);
        $this->waitingRoom()->assertNotFound();
        Auth::logout();
        session()->invalidate();
        $this->waitingRoom()->assertUnauthorized();
        $this->get('/workspace/sessions/'.$this->id('SESSION_C').'/waiting')->assertRedirect('/login');
    }

    public function test_single_session_hall_does_not_confuse_identical_ticket_numbers_in_another_session(): void
    {
        $this->arrivedVisit();
        $future = $this->postJson('/workspace/sessions', [...$this->schedule(), 'doctor_id' => $this->id('DR_C')])->assertCreated()->json('data.id');
        $window = DB::table('arrival_windows')->where('session_id', $future)->orderBy('starts_at')->value('id');
        $receipt = $this->ticketRequest(['session_id' => $future, 'window_id' => $window])->assertCreated();
        $this->ticketBookingCommand($receipt->json('id'), 'confirm')->assertOk();
        $this->doctor();
        $this->callNext()->assertOk()->assertJsonPath('ticket_number', 1);
        $this->owner();
        $this->travelTo(CarbonImmutable::parse('2026-11-07T15:30:00Z'));
        $this->command($future, 'open', version: (int) DB::table('clinic_sessions')->where('id', $future)->value('version'))->assertOk();
        $this->arrival($receipt->json('id'), 2)->assertCreated()->assertJsonPath('ticket_number', 1);
        $this->waitingRoom()->assertOk()->assertJsonPath('called_ticket_numbers', [1])->assertJsonPath('next_ticket_numbers', []);
        $this->waitingRoom($future)->assertOk()->assertJsonPath('called_ticket_numbers', [])->assertJsonPath('next_ticket_numbers', [1]);
        $this->ticket($this->secretFrom($receipt))->assertOk()->assertJsonPath('doctor_state', 'called')->assertJsonPath('waiting_ahead', 0);
    }

    public function test_empty_paused_and_closed_hall_states_are_truthful_and_queries_cannot_change_scope(): void
    {
        $this->waitingRoom()->assertOk()->assertJsonPath('called_ticket_numbers', [])->assertJsonPath('next_ticket_numbers', []);
        foreach (['clinic_id' => $this->id('CLINIC_B'), 'doctor_id' => $this->id('DR_A'), 'phone' => '700000001', 'search' => 'مراجع'] as $field => $value) {
            $this->getJson('/v1/sessions/'.$this->id('SESSION_C').'/waiting?'.http_build_query([$field => $value]))->assertUnprocessable();
        }
        $this->command($this->id('SESSION_C'), 'pause')->assertOk();
        $this->waitingRoom()->assertOk()->assertJsonPath('session_state', 'paused');
        $this->command($this->id('SESSION_C'), 'close', version: 2)->assertOk();
        $this->waitingRoom()->assertOk()->assertJsonPath('session_state', 'closed')->assertJsonPath('called_ticket_numbers', [])->assertJsonPath('next_ticket_numbers', []);
    }
}
